import { Context, Next } from "hono";
import { env } from "../config/env";

export async function cronAuthMiddleware(c: Context, next: Next) {
  const cronSecret = env.CRON_SECRET;

  const headerSecret = c.req.header("x-cron-secret");
  const authHeader = c.req.header("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  const providedSecret = headerSecret || bearerSecret;

  if (!providedSecret || providedSecret !== cronSecret) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or missing CRON_SECRET authentication header",
        },
      },
      401
    );
  }

  await next();
}
