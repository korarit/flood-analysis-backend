import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

export const getR2Endpoint = () => {
  if (env.R2_CUSTOM_ENDPOINT && env.R2_CUSTOM_ENDPOINT.trim().length > 0) {
    return env.R2_CUSTOM_ENDPOINT.trim();
  }
  if (env.R2_ACCOUNT_ID && env.R2_ACCOUNT_ID.trim().length > 0) {
    return `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`;
  }
  return undefined;
};

export const hasR2Credentials = () => {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return false;
  if (
    env.R2_ACCESS_KEY_ID.includes("local_dev") ||
    env.R2_ACCESS_KEY_ID.includes("your_r2") ||
    env.R2_ACCESS_KEY_ID.length < 10
  ) {
    return false;
  }
  return Boolean(getR2Endpoint());
};

export const createR2Client = (): S3Client | null => {
  if (!hasR2Credentials()) {
    return null;
  }

  return new S3Client({
    region: "auto",
    endpoint: getR2Endpoint(),
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || "",
    },
    forcePathStyle: true,
  });
};

export const r2Client = createR2Client();
