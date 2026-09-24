import { describe, it, expect } from "vitest";
import {
  createRetrySession,
  maskQuestionsForClient,
} from "../src/services/interviewService";
import { createTestInterviewSession } from "./fixtures";
import type { InterviewDOState } from "../src/types";

describe("InterviewService", () => {
  it("should create a fresh deep-copy retry session with incremented attempt number", () => {
    const original = createTestInterviewSession("sess_orig");
    original.questions[0].status = "answered";
    original.questions[0].answer = "Old answer";
    original.totalTimeTakenSeconds = 340;

    const retry = createRetrySession(original, "sess_retry_1");

    expect(retry.id).toBe("sess_retry_1");
    expect(retry.attemptNumber).toBe(2);
    expect(retry.retriedFromInterviewId).toBe("sess_orig");
    expect(retry.status).toBeNull();
    expect(retry.totalTimeTakenSeconds).toBeNull();
    expect(retry.questions[0].status).toBeNull();
    expect(retry.questions[0].answer).toBeNull();
    expect(retry.questions[0].followUps[0].status).toBeNull();
  });

  it("should mask future questions when interview is active", () => {
    const session = createTestInterviewSession();
    const liveState: InterviewDOState = {
      schemaVersion: 1,
      interview: session,
      cursor: {
        questionIndex: 0,
        followUpIndex: null,
      },
      pendingSkipConfirmation: null,
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      revision: 1,
      processedRequestIds: [],
    };

    const { session: masked, totalQuestions } = maskQuestionsForClient(session, liveState);

    expect(totalQuestions).toBe(2);
    // On question 0 with no followUp active: only question 0 is visible with 0 follow-ups
    expect(masked.questions.length).toBe(1);
    expect(masked.questions[0].prompt).toBe("How does React reconciliation work?");
    expect(masked.questions[0].followUps.length).toBe(0);
  });

  it("should reveal full interview session when status is completed", () => {
    const session = createTestInterviewSession();
    session.status = "completed";

    const liveState: InterviewDOState = {
      schemaVersion: 1,
      interview: session,
      cursor: {
        questionIndex: 2,
        followUpIndex: null,
      },
      pendingSkipConfirmation: null,
      startedAtMs: Date.now() - 300000,
      updatedAtMs: Date.now(),
      revision: 5,
      processedRequestIds: [],
    };

    const { session: unmasked, totalQuestions } = maskQuestionsForClient(session, liveState);

    expect(totalQuestions).toBe(2);
    expect(unmasked.questions.length).toBe(2);
    expect(unmasked.questions[0].followUps.length).toBe(1);
  });
});
