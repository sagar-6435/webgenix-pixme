import { Injectable } from '@nestjs/common';
import type { DetectedFace, FaceDetectionOptions } from './face-api.engine';

/**
 * Replaceable face-recognition boundary. Swap this provider for an InsightFace,
 * AWS Rekognition, or private inference service without touching upload,
 * matching, privacy, or storage code.
 */
export abstract class FaceEngine {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly dimensions: number;
  abstract initialize(): Promise<void>;
  abstract detect(image: Buffer, options?: FaceDetectionOptions): Promise<DetectedFace[]>;
}

export type { DetectedFace, FaceDetectionOptions };

@Injectable()
export class UnsupportedFaceEngine extends FaceEngine {
  readonly name = 'unsupported';
  readonly version = '0';
  readonly dimensions = 0;

  async initialize(): Promise<void> {
    throw new Error('No face engine configured');
  }

  async detect(): Promise<DetectedFace[]> {
    throw new Error('No face engine configured');
  }
}
