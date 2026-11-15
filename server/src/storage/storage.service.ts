import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

export interface StoredObject {
  body: Readable;
  contentType?: string;
  contentLength?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  private bucket!: string;
  private signedUrlTtl!: number;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.bucket = this.config.getOrThrow<string>('storage.bucket');
    this.signedUrlTtl = this.config.get<number>('storage.signedUrlTtl') ?? 900;
    this.client = new S3Client({
      endpoint: this.config.getOrThrow<string>('storage.endpoint'),
      region: this.config.getOrThrow<string>('storage.region'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('storage.accessKey'),
        secretAccessKey: this.config.getOrThrow<string>('storage.secretKey'),
      },
      forcePathStyle: this.config.get<boolean>('storage.forcePathStyle') ?? true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        await this.ensureBucket();
        this.logger.log(`Object storage ready (bucket: ${this.bucket})`);
        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Storage not ready (attempt ${attempt}/8): ${lastError.message}`);
        await sleep(1500);
      }
    }
    throw new Error(`Object storage unavailable: ${lastError?.message ?? 'unknown error'}`);
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404 || (error as Error).name === 'NotFound') {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created object storage bucket ${this.bucket}`);
      } else {
        throw error;
      }
    }

    // Defense in depth: temporary selfies expire even if the worker crashes
    // before deleting the object. The app also deletes them immediately.
    try {
      await this.client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'expire-temporary-biometric-data',
                Filter: { Prefix: 'biometric/' },
                Status: 'Enabled',
                Expiration: { Days: 1 },
              },
            ],
          },
        }),
      );
    } catch (error) {
      this.logger.warn(`Could not set biometric lifecycle rule: ${(error as Error).message}`);
    }
  }

  async head(key: string): Promise<{ contentLength?: number; contentType?: string } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { contentLength: result.ContentLength, contentType: result.ContentType };
    } catch {
      return null;
    }
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: key.startsWith('biometric/')
          ? 'no-store'
          : 'private, max-age=31536000, immutable',
        Metadata: metadata,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error(`Object ${key} has no body`);
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getStream(key: string): Promise<StoredObject> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error(`Object ${key} has no body`);
    return {
      body: result.Body as Readable,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
    };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async listKeys(prefix: string): Promise<{ key: string; lastModified?: Date; size?: number }[]> {
    const objects: { key: string; lastModified?: Date; size?: number }[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const item of result.Contents ?? []) {
        if (item.Key) {
          objects.push({ key: item.Key, lastModified: item.LastModified, size: item.Size });
        }
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async removePrefix(prefix: string): Promise<number> {
    const objects = await this.listKeys(prefix);
    let removed = 0;
    for (let i = 0; i < objects.length; i += 1000) {
      const batch = objects.slice(i, i + 1000);
      if (!batch.length) continue;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map(({ key }) => ({ Key: key })), Quiet: true },
        }),
      );
      removed += batch.length;
    }
    return removed;
  }

  async signedGetUrl(
    key: string,
    options?: { ttlSeconds?: number; downloadName?: string; contentType?: string },
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(options?.contentType ? { ResponseContentType: options.contentType } : {}),
      ...(options?.downloadName
        ? {
            ResponseContentDisposition: `attachment; filename="${options.downloadName.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(options.downloadName)}`,
          }
        : {}),
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options?.ttlSeconds ?? this.signedUrlTtl,
    });
  }

  async healthCheck(): Promise<number> {
    const start = Date.now();
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return Date.now() - start;
  }

  getBucket(): string {
    return this.bucket;
  }

  getClient(): S3Client {
    return this.client;
  }
}
