import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, desc, and } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { getDb } from "../db";
import { interviewAttempts } from "../db/schema";
import {
  CreateInterviewRequestSchema,
  GenerateInterviewRequestSchema,
  RetryInterviewRequestSchema,
  type Env,
} from "../types";
import { generateInterviewTemplate } from "../generator";
import {
  createRetrySession,
  maskQuestionsForClient,
} from "../services/interviewService";
import { getCandidateId, isInternalAgentRequest } from "../middlewares/auth";

export const interviewsRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/interviews
 * Initializes an interview session from a provided InterviewSession template object.
 */
interviewsRouter.post(
  "/",
  zValidator("json", CreateInterviewRequestSchema, (result, c) => {
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
    const { session, userId: bodyUserId } = c.req.valid("json");
    const candidateId = (await getCandidateId(c)) || bodyUserId;

    if (!candidateId) {
      throw new HTTPException(401, {
        message: "Unauthorized: Candidate identity required",
      });
    }

    const db = getDb(c.env.DB);

    // Save initial record to D1
    await db.insert(interviewAttempts).values({
      id: session.id,
      templateId: session.templateId,
      attemptGroupId: session.attemptGroupId,
      attemptNumber: session.attemptNumber,
      retriedFromInterviewId: session.retriedFromInterviewId,
      candidateId,
      title: session.title,
      userPrompt: session.userPrompt,
      interviewLengthSeconds: session.interviewLengthSeconds,
      status: "in_progress",
      sessionData: session,
    });

    // Initialize the Durable Object state machine
    const doId = c.env.INTERVIEW_SESSION.idFromName(session.id);
    const stub = c.env.INTERVIEW_SESSION.get(doId);
    const initialPrompt = await stub.initialize(session);

    return c.json(
      {
        success: true,
        interviewId: session.id,
        title: session.title,
        prompt: initialPrompt,
      },
      201
    );
  }
);

/**
 * POST /api/interviews/generate
 * Generates an interview session from prompt using Gemini, saves to D1, and initializes the Durable Object.
 */
interviewsRouter.post(
  "/generate",
  zValidator("json", GenerateInterviewRequestSchema, (result, c) => {
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
    const { prompt, targetCount, userId: bodyUserId } = c.req.valid("json");
    const candidateId = (await getCandidateId(c)) || bodyUserId;

    if (!candidateId) {
      throw new HTTPException(401, {
        message: "Unauthorized: Candidate identity required",
      });
    }

    const apiKey = c.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new HTTPException(500, {
        message: "GOOGLE_API_KEY is not configured",
      });
    }

    // Generate structured interview session via LLM
    const session = await generateInterviewTemplate({
      userPrompt: prompt,
      apiKey,
      targetCount,
    });

    const db = getDb(c.env.DB);

    // Save initial record to D1
    await db.insert(interviewAttempts).values({
      id: session.id,
      templateId: session.templateId,
      attemptGroupId: session.attemptGroupId,
      attemptNumber: session.attemptNumber,
      retriedFromInterviewId: session.retriedFromInterviewId,
      candidateId,
      title: session.title,
      userPrompt: session.userPrompt,
      interviewLengthSeconds: session.interviewLengthSeconds,
      status: "in_progress",
      sessionData: session,
    });

    // Initialize the Durable Object state machine
    const doId = c.env.INTERVIEW_SESSION.idFromName(session.id);
    const stub = c.env.INTERVIEW_SESSION.get(doId);
    const initialPrompt = await stub.initialize(session);

    return c.json(
      {
        success: true,
        interviewId: session.id,
        title: session.title,
        prompt: initialPrompt,
      },
      201
    );
  }
);

/**
 * GET /api/interviews
 * List all interview sessions for the authenticated user.
 */
interviewsRouter.get("/", async (c) => {
  const candidateId = await getCandidateId(c);
  if (!candidateId) {
    throw new HTTPException(401, {
      message: "Unauthorized: Candidate identity required",
    });
  }

  const db = getDb(c.env.DB);
  const records = await db
    .select()
    .from(interviewAttempts)
    .where(eq(interviewAttempts.candidateId, candidateId))
    .orderBy(desc(interviewAttempts.createdAt));

  return c.json(records);
});

/**
 * GET /api/interviews/:id
 * Retrieve details for a specific interview session.
 * Future questions are strictly masked during active interviews.
 */
interviewsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const isInternal = isInternalAgentRequest(c);
  const candidateId = await getCandidateId(c);

  if (!isInternal && !candidateId) {
    throw new HTTPException(401, {
      message: "Unauthorized: Candidate identity required",
    });
  }

  const db = getDb(c.env.DB);
  const conditions = [eq(interviewAttempts.id, id)];
  if (!isInternal && candidateId) {
    conditions.push(eq(interviewAttempts.candidateId, candidateId));
  }

  const [record] = await db
    .select()
    .from(interviewAttempts)
    .where(and(...conditions));

  if (!record) {
    throw new HTTPException(404, { message: "Interview session not found" });
  }

  // Fetch live state from Durable Object if available
  const doId = c.env.INTERVIEW_SESSION.idFromName(id);
  const stub = c.env.INTERVIEW_SESSION.get(doId);
  const liveState = await stub.getState().catch(() => null);

  const session = liveState?.interview || record.sessionData;
  if (!session) {
    return c.json({ record, liveState });
  }

  if (isInternal) {
    return c.json({
      record,
      liveState,
    });
  }

  const { session: maskedSession, totalQuestions } = maskQuestionsForClient(
    session,
    liveState
  );

  return c.json({
    record: {
      ...record,
      sessionData: maskedSession,
    },
    liveState: liveState
      ? {
          ...liveState,
          totalQuestions,
          interview: maskedSession,
        }
      : null,
  });
});

/**
 * POST /api/interviews/:id/retry
 * Create a fresh retry attempt cloned from a completed/previous interview.
 */
interviewsRouter.post(
  "/:id/retry",
  zValidator("json", RetryInterviewRequestSchema),
  async (c) => {
    const oldId = c.req.param("id");
    const { newSessionId, userId: bodyUserId } = c.req.valid("json");
    const candidateId = (await getCandidateId(c)) || bodyUserId;

    if (!candidateId) {
      throw new HTTPException(401, {
        message: "Unauthorized: Candidate identity required",
      });
    }

    const db = getDb(c.env.DB);
    const [oldRecord] = await db
      .select()
      .from(interviewAttempts)
      .where(
        and(
          eq(interviewAttempts.id, oldId),
          eq(interviewAttempts.candidateId, candidateId)
        )
      );

    if (!oldRecord || !oldRecord.sessionData) {
      throw new HTTPException(404, {
        message: "Previous interview session not found",
      });
    }

    const retrySession = createRetrySession(
      oldRecord.sessionData,
      newSessionId
    );

    // Save retry record to D1
    await db.insert(interviewAttempts).values({
      id: retrySession.id,
      templateId: retrySession.templateId,
      attemptGroupId: retrySession.attemptGroupId,
      attemptNumber: retrySession.attemptNumber,
      retriedFromInterviewId: oldId,
      candidateId,
      title: retrySession.title,
      userPrompt: retrySession.userPrompt,
      interviewLengthSeconds: retrySession.interviewLengthSeconds,
      status: "in_progress",
      sessionData: retrySession,
    });

    // Initialize fresh DO
    const doId = c.env.INTERVIEW_SESSION.idFromName(retrySession.id);
    const stub = c.env.INTERVIEW_SESSION.get(doId);
    const initialPrompt = await stub.initialize(retrySession);

    return c.json(
      {
        success: true,
        interviewId: retrySession.id,
        prompt: initialPrompt,
      },
      201
    );
  }
);
