import { Hono } from "hono";
import { cors } from "hono/cors";
import { clerkMiddleware } from "@clerk/hono";
import { errorHandler } from "./middlewares/error";
import { interviewsRouter } from "./routes/interviews";
import { sessionRouter } from "./routes/session";
import { tokensRouter } from "./routes/tokens";
import { InterviewSessionDO } from "./durable-objects/InterviewSessionDO";
import type { Env } from "./types";

export { InterviewSessionDO };

const app = new Hono<{ Bindings: Env }>();

// Global Middleware
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-user-id",
      "x-interview-id",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
    credentials: true,
  })
);

app.use("*", async (c, next) => {
  const env = (c.env || {}) as any;
  if (
    env.CLERK_SECRET_KEY ||
    env.CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_SECRET_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY
  ) {
    try {
      return await clerkMiddleware()(c, next);
    } catch {
      await next();
    }
  } else {
    await next();
  }
});
app.onError(errorHandler);

// Health Check
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Route Mounts
app.route("/api/interviews", interviewsRouter);
app.route("/api/interviews", sessionRouter);
app.route("/api/interviews", tokensRouter);

export default app;
