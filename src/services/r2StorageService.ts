import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "../config/env";
import { hasR2Credentials, r2Client } from "../config/r2";

export class R2StorageService {
  private bucketName: string;
  private localFallbackDir: string;

  constructor() {
    this.bucketName = env.R2_BUCKET_NAME;
    this.localFallbackDir = join(process.cwd(), ".r2-local");
    if (!existsSync(this.localFallbackDir)) {
      mkdirSync(this.localFallbackDir, { recursive: true });
    }
  }

  /**
   * Generates public URL for a given object key
   */
  public getPublicUrl(key: string): string {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    const base = env.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
    return `${base}/${cleanKey}`;
  }

  /**
   * Save a JSON or GeoJSON object to R2 (and mirrors to local fallback if enabled)
   */
  async putJson(
    key: string,
    data: any,
    cacheControl: string = "public, max-age=120, s-maxage=120"
  ): Promise<{ success: boolean; etag?: string; url: string }> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    const jsonString = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(jsonString, "utf-8");
    const isGeoJson = cleanKey.endsWith(".geojson");
    const contentType = isGeoJson ? "application/geo+json; charset=utf-8" : "application/json; charset=utf-8";

    // 1. Mirror to local directory if enabled
    if (env.R2_LOCAL_FALLBACK) {
      try {
        const localPath = join(this.localFallbackDir, cleanKey);
        const parentDir = dirname(localPath);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        writeFileSync(localPath, jsonString, "utf-8");
      } catch (localErr) {
        console.warn(`⚠️ Failed to write local fallback for key: ${cleanKey}`, localErr);
      }
    }

    // 2. Upload to Cloudflare R2 if client is available
    let etag: string | undefined;
    if (hasR2Credentials() && r2Client) {
      try {
        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: cleanKey,
          Body: buffer,
          ContentType: contentType,
          CacheControl: cacheControl,
        });
        const res = await r2Client.send(command);
        etag = res.ETag;
      } catch (r2Err) {
        console.error(`❌ Cloudflare R2 Upload failed for key: ${cleanKey}`, r2Err);
        if (!env.R2_LOCAL_FALLBACK) {
          throw r2Err;
        }
      }
    }

    return {
      success: true,
      etag,
      url: this.getPublicUrl(cleanKey),
    };
  }

  /**
   * Read JSON object from R2 (with local fallback)
   */
  async getJson<T = any>(key: string): Promise<T | null> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;

    // Try Cloudflare R2 first if available
    if (hasR2Credentials() && r2Client) {
      try {
        const command = new GetObjectCommand({
          Bucket: this.bucketName,
          Key: cleanKey,
        });
        const response = await r2Client.send(command);
        if (response.Body) {
          const str = await response.Body.transformToString("utf-8");
          return JSON.parse(str) as T;
        }
      } catch (err: any) {
        if (err.name !== "NoSuchKey" && err.$metadata?.httpStatusCode !== 404) {
          console.warn(`⚠️ R2 getObject failed for ${cleanKey}, checking local fallback...`);
        }
      }
    }

    // Check local fallback
    if (env.R2_LOCAL_FALLBACK) {
      const localPath = join(this.localFallbackDir, cleanKey);
      if (existsSync(localPath)) {
        const str = readFileSync(localPath, "utf-8");
        return JSON.parse(str) as T;
      }
    }

    return null;
  }

  /**
   * Delete an object from R2 & local mirror
   */
  async deleteObject(key: string): Promise<boolean> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;

    if (hasR2Credentials() && r2Client) {
      try {
        const command = new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: cleanKey,
        });
        await r2Client.send(command);
      } catch (err) {
        console.error(`❌ Failed to delete object ${cleanKey} from R2`, err);
      }
    }

    if (env.R2_LOCAL_FALLBACK) {
      const localPath = join(this.localFallbackDir, cleanKey);
      if (existsSync(localPath)) {
        try {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(localPath);
        } catch {}
      }
    }

    return true;
  }

  /**
   * List objects with a specific prefix
   */
  async listObjects(prefix: string): Promise<string[]> {
    const cleanPrefix = prefix.startsWith("/") ? prefix.slice(1) : prefix;

    if (hasR2Credentials() && r2Client) {
      try {
        const command = new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: cleanPrefix,
        });
        const res = await r2Client.send(command);
        return (res.Contents || []).map((c) => c.Key!).filter(Boolean);
      } catch (err) {
        console.error(`❌ Failed to list objects in R2 with prefix ${cleanPrefix}`, err);
      }
    }

    return [];
  }

  /**
   * Get a presigned upload URL for direct client upload
   */
  async getPresignedUploadUrl(key: string, expiresIn: number = 3600): Promise<string | null> {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    if (!hasR2Credentials() || !r2Client) {
      return null;
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: cleanKey,
    });
    return await getSignedUrl(r2Client, command, { expiresIn });
  }
}

export const r2Storage = new R2StorageService();
