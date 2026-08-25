import { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export function errorHandler(err: Error, c: Context) {
  console.error("💥 Uncaught Application Error:", err);

  if (err instanceof ZodError) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.flatten(),
        },
      },
      400
    );
  }

  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: {
          code: `HTTP_${err.status}`,
          message: err.message,
        },
      },
      err.status
    );
  }

  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: err.message || "An unexpected error occurred",
      },
    },
    500
  );
}
