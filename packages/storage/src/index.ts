import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

export type S3StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export class S3StorageHealth {
  readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  destroy(): void {
    this.client.destroy();
  }
}

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  destroy(): void;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!result.Body) throw new Error(`Object ${key} has no body.`);
    if (result.Body instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  destroy(): void {
    this.client.destroy();
  }
}
