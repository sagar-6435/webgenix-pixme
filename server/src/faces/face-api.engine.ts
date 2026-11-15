import { Injectable, Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dirname, join } from 'path';
import type { Metadata } from 'sharp';
import type { Tensor3D } from '@tensorflow/tfjs-node';

/* eslint-disable @typescript-eslint/no-var-requires */
// tfjs-node and face-api rely on deprecated Node util helpers removed in
// newer Node releases. Patch the actual Node util module before loading the native bindings.
const util = require('util') as Record<string, unknown>;
const polyfills: Record<string, unknown> = {
  isNullOrUndefined: (value: unknown) => value === null || value === undefined,
  isArray: Array.isArray,
  isString: (value: unknown) => typeof value === 'string',
  isObject: (value: unknown) => value !== null && typeof value === 'object',
  isFunction: (value: unknown) => typeof value === 'function',
  isNumber: (value: unknown) => typeof value === 'number',
  isBoolean: (value: unknown) => typeof value === 'boolean',
  isBuffer: Buffer.isBuffer,
};
for (const [key, fn] of Object.entries(polyfills)) {
  try {
    Object.defineProperty(util, key, {
      value: fn,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    util[key] = fn;
  }
}
process.env.TF_CPP_MIN_LOG_LEVEL = process.env.TF_CPP_MIN_LOG_LEVEL ?? '2';

const tf: typeof import('@tensorflow/tfjs-node') = require('@tensorflow/tfjs-node');
const faceapi: typeof import('@vladmandic/face-api') = require('@vladmandic/face-api');
import sharp from 'sharp';

export interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
  confidence: number;
  embedding: number[];
}

export interface FaceDetectionOptions {
  mode?: 'index' | 'selfie';
  maxDimension?: number;
  minConfidence?: number;
  minFaceSizePx?: number;
}

@Injectable()
export class FaceApiEngine {
  readonly name = 'face-api';
  readonly version = 'ssd-mobilenetv1+facenet-128@1.7.15';
  readonly dimensions = 128;

  private readonly logger = new Logger(FaceApiEngine.name);
  private readonly minConfidence: number;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.minConfidence = this.config.get<number>('ai.minConfidence') ?? 0.55;
  }

  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadModels();
    }
    return this.initPromise;
  }

  private async loadModels(): Promise<void> {
    const configured = this.config.get<string>('ai.modelDir');
    const modelDir =
      configured ??
      join(dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');

    await tf.ready();
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir),
      faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir),
      faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir),
    ]);
    this.logger.log(`Face models loaded from ${modelDir} (backend: ${tf.getBackend()})`);
  }

  async detect(image: Buffer, options: FaceDetectionOptions = {}): Promise<DetectedFace[]> {
    await this.initialize();

    const mode = options.mode ?? 'index';
    const maxDimension = options.maxDimension ?? (mode === 'selfie' ? 960 : 1600);
    const minConfidence =
      options.minConfidence ?? (mode === 'selfie' ? Math.max(0.7, this.minConfidence) : 0.4);
    const minFaceSizePx = options.minFaceSizePx ?? (mode === 'selfie' ? 100 : 32);

    let metadata: Metadata;
    try {
      metadata = await sharp(image).metadata();
    } catch {
      throw new UnsupportedMediaTypeException('The file is not a valid image');
    }
    if (!metadata.format || !['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff'].includes(metadata.format)) {
      throw new UnsupportedMediaTypeException('Only JPEG, PNG, WebP, AVIF, or TIFF images are supported');
    }
    if (metadata.width && metadata.height && metadata.width * metadata.height < 160 * 120) {
      throw new UnsupportedMediaTypeException('The image is too small to analyze');
    }

    let decoded: { data: Buffer; info: { width: number; height: number; channels: number } };
    try {
      decoded = (await sharp(image)
        .rotate()
        .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })) as unknown as {
        data: Buffer;
        info: { width: number; height: number; channels: number };
      };
    } catch {
      throw new UnsupportedMediaTypeException('The image could not be decoded');
    }

    if (decoded.info.channels !== 3) {
      throw new UnsupportedMediaTypeException('Unsupported image colour format');
    }

    const tensor = tf.tensor3d(
      new Uint8Array(decoded.data),
      [decoded.info.height, decoded.info.width, 3],
      'int32',
    ) as Tensor3D;

    try {
      const detections = await faceapi
        .detectAllFaces(
          tensor as unknown as Parameters<typeof faceapi.detectAllFaces>[0],
          new faceapi.SsdMobilenetv1Options({
            minConfidence,
            maxResults: mode === 'selfie' ? 5 : 200,
          }),
        )
        .withFaceLandmarks()
        .withFaceDescriptors();

      return detections
        .filter(
          (detection) =>
            detection.detection.box.width >= minFaceSizePx &&
            detection.detection.box.height >= minFaceSizePx &&
            detection.descriptor?.length === this.dimensions &&
            Array.from(detection.descriptor).every((value) => Number.isFinite(value)),
        )
        .sort((a, b) => b.detection.score - a.detection.score)
        .map((detection) => ({
          boundingBox: {
            x: Number((detection.detection.box.x / decoded.info.width).toFixed(5)),
            y: Number((detection.detection.box.y / decoded.info.height).toFixed(5)),
            width: Number((detection.detection.box.width / decoded.info.width).toFixed(5)),
            height: Number((detection.detection.box.height / decoded.info.height).toFixed(5)),
          },
          confidence: Number(detection.detection.score.toFixed(4)),
          embedding: Array.from(detection.descriptor),
        }));
    } finally {
      tensor.dispose();
    }
  }
}
