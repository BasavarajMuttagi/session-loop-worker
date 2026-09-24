import { eq } from "drizzle-orm";
import type { AppDb } from "../db";
import { interviewAttempts } from "../db/schema";
import type { InterviewSession, InterviewDOState } from "../types";
import type { InterviewSessionDO } from "../durable-objects/InterviewSessionDO";

/**
 * Creates a clean deep-copy of an interview session for a retry attempt.
 */
export function createRetrySession(
  previousSession: InterviewSession,
  newSessionId: string
): InterviewSession {
  return {
    id: newSessionId,
    templateId: previousSession.templateId,
    attemptGroupId: previousSession.attemptGroupId,
    attemptNumber: previousSession.attemptNumber + 1,
    retriedFromInterviewId: previousSession.id,
    title: previousSession.title,
    userPrompt: previousSession.userPrompt,
    interviewLengthSeconds: previousSession.interviewLengthSeconds,
    totalTimeTakenSeconds: null,
    status: null,
    opening: previousSession.opening,
    closing: previousSession.closing,
    questions: previousSession.questions.map((q, qIdx) => ({
      id: q.id || `q_${qIdx + 1}`,
      prompt: q.prompt,
      clarify: q.clarify,
      expectedAnswer: q.expectedAnswer,
      answer: null,
      status: null,
      timerSeconds: q.timerSeconds,
      followUps: (q.followUps || []).map((f, fIdx) => ({
        id: f.id || `fu_${qIdx + 1}_${fIdx + 1}`,
        prompt: f.prompt,
        clarify: f.clarify,
        expectedAnswer: f.expectedAnswer,
        answer: null,
        status: null,
        timerSeconds: f.timerSeconds,
      })),
    })),
  };
}

/**
 * Masks future questions and unasked follow-ups for live interview sessions
 * so that candidate privacy, strict 1-by-1 progression, and interview integrity are preserved.
 */
export function maskQuestionsForClient(
  session: InterviewSession,
  liveState: InterviewDOState | null
): {
  session: InterviewSession;
  totalQuestions: number;
} {
  const totalQuestions = session.questions?.length || 0;

  if (!liveState || liveState.interview.status === "completed") {
    return { session, totalQuestions };
  }

  const currentQIndex = liveState.cursor.questionIndex;
  const currentFIndex = liveState.cursor.followUpIndex;

  const unlockedQuestions = session.questions
    .slice(0, currentQIndex + 1)
    .map((q, idx) => {
      const isCurrentQuestion = idx === currentQIndex;
      let visibleFollowUps = q.followUps || [];

      if (isCurrentQuestion) {
        visibleFollowUps =
          currentFIndex !== null
            ? visibleFollowUps.slice(0, currentFIndex + 1)
            : [];
      } else {
        visibleFollowUps = visibleFollowUps.filter((f) => f.status !== null);
      }

      return {
        ...q,
        followUps: visibleFollowUps,
      };
    });

  return {
    session: {
      ...session,
      questions: unlockedQuestions,
    },
    totalQuestions,
  };
}

/**
 * Persists and synchronizes the Durable Object live state to D1.
 */
export async function syncDOToD1(
  db: AppDb,
  stub: DurableObjectStub<InterviewSessionDO>,
  interviewId: string
): Promise<void> {
  try {
    const liveState = await stub.getState();
    if (!liveState) return;

    await db
      .update(interviewAttempts)
      .set({
        status: (liveState.interview.status as any) || "in_progress",
        totalTimeTakenSeconds: liveState.interview.totalTimeTakenSeconds,
        sessionData: liveState.interview,
        completedAt:
          liveState.interview.status === "completed"
            ? new Date().toISOString()
            : null,
      })
      .where(eq(interviewAttempts.id, interviewId));
  } catch (err) {
    console.error(`[InterviewService] Failed to sync DO state to D1 for ${interviewId}:`, err);
  }
}
