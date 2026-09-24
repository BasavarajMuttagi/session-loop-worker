import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

/**
 * Centralized error handler for clean, structured JSON API errors.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: err.message,
      },
      err.status
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        success: false,
        error: "Validation failed",
        details: err.flatten().fieldErrors,
      },
      400
    );
  }

  console.error("[ServerError]", err);
  return c.json(
    {
      success: false,
      error: err instanceof Error ? err.message : "Internal server error",
    },
    500
  );
};
