import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getDb } from "../db";
import {
  SubmitAnswerRequestSchema,
  SkipRequestSchema,
  ConfirmSkipRequestSchema,
  type Env,
} from "../types";
import { syncDOToD1 } from "../services/interviewService";

export const sessionRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/interviews/:id/answer
 * Submits candidate's answer and advances the state machine.
 */
sessionRouter.post(
  "/:id/answer",
  zValidator("json", SubmitAnswerRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: "Validation failed",
          details: result.error.issues,
        },
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const doId = c.env.INTERVIEW_SESSION.idFromName(id);
    const stub = c.env.INTERVIEW_SESSION.get(doId);
    const nextPrompt = await stub.submitAnswer(body);

    if (nextPrompt.isComplete) {
      const db = getDb(c.env.DB);
      await syncDOToD1(db, stub, id);
    }

    return c.json(nextPrompt);
  }
);

/**
 * POST /api/interviews/:id/skip
 * Directly skips active prompt with candidate's transcript.
 */
sessionRouter.post(
  "/:id/skip",
  zValidator("json", SkipRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: "Validation failed",
          details: result.error.issues,
        },
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const doId = c.env.INTERVIEW_SESSION.idFromName(id);
    const stub = c.env.INTERVIEW_SESSION.get(doId);
    const nextPrompt = await stub.skip({
      requestId: body.requestId || crypto.randomUUID(),
      transcript: body.transcript,
    });

    if (nextPrompt.isComplete) {
      const db = getDb(c.env.DB);
      await syncDOToD1(db, stub, id);
    }

    return c.json(nextPrompt);
  }
);

/**
 * POST /api/interviews/:id/skip/request
 * Initiates skip confirmation prompt.
 */
sessionRouter.post("/:id/skip/request", async (c) => {
  const id = c.req.param("id");
  const doId = c.env.INTERVIEW_SESSION.idFromName(id);
  const stub = c.env.INTERVIEW_SESSION.get(doId);
  const response = await stub.requestSkip();
  return c.json(response);
});

/**
 * POST /api/interviews/:id/skip/confirm
 * Confirms or declines skip.
 */
sessionRouter.post(
  "/:id/skip/confirm",
  zValidator("json", ConfirmSkipRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: "Validation failed",
          details: result.error.issues,
        },
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const doId = c.env.INTERVIEW_SESSION.idFromName(id);
    const stub = c.env.INTERVIEW_SESSION.get(doId);
    const nextPrompt = await stub.confirmSkip(body);

    if (nextPrompt.isComplete) {
      const db = getDb(c.env.DB);
      await syncDOToD1(db, stub, id);
    }

    return c.json(nextPrompt);
  }
);

/**
 * GET /api/interviews/:id/clarify
 * Clarification query for active prompt.
 */
sessionRouter.get("/:id/clarify", async (c) => {
  const id = c.req.param("id");
  const doId = c.env.INTERVIEW_SESSION.idFromName(id);
  const stub = c.env.INTERVIEW_SESSION.get(doId);
  const response = await stub.getClarification();
  return c.json(response);
});

/**
 * GET /api/interviews/:id/repeat
 * Repeat active prompt query.
 */
sessionRouter.get("/:id/repeat", async (c) => {
  const id = c.req.param("id");
  const doId = c.env.INTERVIEW_SESSION.idFromName(id);
  const stub = c.env.INTERVIEW_SESSION.get(doId);
  const response = await stub.repeatPrompt();
  return c.json(response);
});

/**
 * GET /api/interviews/:id/current-prompt
 * Get active prompt directly from DO.
 */
sessionRouter.get("/:id/current-prompt", async (c) => {
  const id = c.req.param("id");
  const doId = c.env.INTERVIEW_SESSION.idFromName(id);
  const stub = c.env.INTERVIEW_SESSION.get(doId);
  const response = await stub.getCurrentPrompt();
  return c.json(response);
});

/**
 * POST /api/interviews/:id/end
 * Explicitly completes and finalizes an interview session.
 */
sessionRouter.post("/:id/end", async (c) => {
  const id = c.req.param("id");
  const doId = c.env.INTERVIEW_SESSION.idFromName(id);
  const stub = c.env.INTERVIEW_SESSION.get(doId);
  const result = await stub.endSession();

  const db = getDb(c.env.DB);
  await syncDOToD1(db, stub, id);

  return c.json(result);
});
