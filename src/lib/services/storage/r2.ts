import { normalizeStorageKey, StorageObjectNotFoundError, type StorageService } from "./types.ts";

// R2 for the PDFs. The binding name is PDFS. A second write with
// keepExisting is refused by the bucket, so one of two racing writers wins.

const R2_BUCKET_NAME = "equity-on-sign-staging";

type R2ObjectLike = {
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array>;
  etag?: string;
  httpMetadata?: { contentType?: string };
  size?: number;
};

type R2BucketLike = {
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2ObjectLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string };
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ): Promise<R2ObjectLike | null>;
};

export function createR2StorageService(bucket: R2BucketLike): StorageService {
  return {
    async deleteObject(key) {
      await bucket.delete(normalizeStorageKey(key));
    },
    async getObject(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = await bucket.get(normalizedKey);

      if (!object) {
        throw new StorageObjectNotFoundError(normalizedKey);
      }

      return {
        body: new Uint8Array(await object.arrayBuffer()),
        bucketName: R2_BUCKET_NAME,
        contentLength: object.size,
        contentType: object.httpMetadata?.contentType,
        etag: object.etag,
        key: normalizedKey,
      };
    },
    async getObjectStream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = await bucket.get(normalizedKey);

      if (!object?.body) {
        throw new StorageObjectNotFoundError(normalizedKey);
      }

      return {
        bucketName: R2_BUCKET_NAME,
        contentLength: object.size,
        contentType: object.httpMetadata?.contentType,
        key: normalizedKey,
        stream: object.body,
      };
    },
    async headObject(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = await bucket.head(normalizedKey);

      if (!object) {
        return { bucketName: R2_BUCKET_NAME, exists: false, key: normalizedKey };
      }

      return {
        bucketName: R2_BUCKET_NAME,
        contentLength: object.size,
        contentType: object.httpMetadata?.contentType,
        etag: object.etag,
        exists: true,
        key: normalizedKey,
      };
    },
    async putObject(input) {
      const normalizedKey = normalizeStorageKey(input.key);
      const options = {
        httpMetadata: { contentType: input.contentType },
        ...(input.keepExisting
          ? { onlyIf: { etagDoesNotMatch: "*" } }
          : {}),
      };

      try {
        await bucket.put(normalizedKey, input.body, options);
      } catch (error) {
        if (!input.keepExisting) {
          throw error;
        }
      }

      return { bucketName: R2_BUCKET_NAME, key: normalizedKey };
    },
  };
}
