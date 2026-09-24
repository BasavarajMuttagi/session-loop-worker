import { describe, it, expect, beforeEach } from "vitest";
import { InterviewSessionDO } from "../src/durable-objects/InterviewSessionDO";
import { createMockDOState } from "./mock-do";
import { createTestInterviewSession } from "./fixtures";
import type { Env } from "../src/types";

describe("InterviewSessionDO State Machine", () => {
  let doInstance: InterviewSessionDO;
  let mockState: ReturnType<typeof createMockDOState>;

  beforeEach(() => {
    mockState = createMockDOState();
    doInstance = new InterviewSessionDO(mockState.ctx, {} as Env);
  });

  it("should initialize interview session and return initial question prompt", async () => {
    const session = createTestInterviewSession();
    const prompt = await doInstance.initialize(session);

    expect(prompt.type).toBe("question");
    expect(prompt.text).toBe("How does React reconciliation work?");
    expect(prompt.cursor).toEqual({ questionIndex: 0, followUpIndex: null });
    expect(prompt.isComplete).toBe(false);

    const state = await doInstance.getState();
    expect(state).not.toBeNull();
    expect(state?.interview.status).toBe("in_progress");
    expect(mockState.getAlarmMs()).toBeGreaterThan(Date.now());
  });

  it("should safely return existing prompt if initialize is called again", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    // Answer first question
    await doInstance.submitAnswer({
      requestId: "req-1",
      transcript: "React uses Fiber tree to diff elements by key and type.",
    });

    // Re-initialize should not wipe progress
    const prompt = await doInstance.initialize(session);
    expect(prompt.type).toBe("follow_up");
    expect(prompt.text).toBe("What are the trade-offs of using array index as key?");
  });

  it("should transition through main questions and follow-ups accurately", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    // 1. Answer Q1 main question -> advances to Q1 follow-up 1
    const p1 = await doInstance.submitAnswer({
      requestId: "req-1",
      transcript: "Reconciliation is the process of comparing virtual DOM trees.",
    });
    expect(p1.type).toBe("follow_up");
    expect(p1.text).toBe("What are the trade-offs of using array index as key?");
    expect(p1.cursor).toEqual({ questionIndex: 0, followUpIndex: 0 });

    // 2. Answer Q1 follow-up -> advances to Q2 main question
    const p2 = await doInstance.submitAnswer({
      requestId: "req-2",
      transcript: "Array indices as keys break if items are reordered or filtered.",
    });
    expect(p2.type).toBe("question");
    expect(p2.text).toBe("Explain how useMemo and useCallback differ.");
    expect(p2.cursor).toEqual({ questionIndex: 1, followUpIndex: null });

    // 3. Answer Q2 main question -> interview completes
    const p3 = await doInstance.submitAnswer({
      requestId: "req-3",
      transcript: "useMemo returns a memoized value, while useCallback returns a memoized callback.",
    });
    expect(p3.type).toBe("completed");
    expect(p3.isComplete).toBe(true);
    expect(p3.text).toBe(session.closing);

    const finalState = await doInstance.getState();
    expect(finalState?.interview.status).toBe("completed");
    expect(finalState?.interview.totalTimeTakenSeconds).toBeGreaterThanOrEqual(0);
    expect(finalState?.interview.questions[0].status).toBe("answered");
    expect(finalState?.interview.questions[0].followUps[0].status).toBe("answered");
    expect(finalState?.interview.questions[1].status).toBe("answered");
  });

  it("should be idempotent against duplicate requestIds", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    const first = await doInstance.submitAnswer({
      requestId: "req-dup-1",
      transcript: "Initial response.",
    });

    const second = await doInstance.submitAnswer({
      requestId: "req-dup-1",
      transcript: "Duplicate submission of same request.",
    });

    expect(second.cursor).toEqual(first.cursor);
    expect(second.text).toBe(first.text);
  });

  it("should skip questions and record candidate exact transcript", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    // Skip Q1 main question -> skips follow-ups as well, advancing directly to Q2
    const p = await doInstance.skip({
      requestId: "req-skip-1",
      transcript: "I'd like to skip this reconciliation question.",
    });

    expect(p.type).toBe("question");
    expect(p.text).toBe("Explain how useMemo and useCallback differ.");
    expect(p.cursor).toEqual({ questionIndex: 1, followUpIndex: null });

    const state = await doInstance.getState();
    expect(state?.interview.questions[0].status).toBe("skipped");
    expect(state?.interview.questions[0].answer).toBe(
      "I'd like to skip this reconciliation question."
    );
    // Unasked follow-ups must remain null
    expect(state?.interview.questions[0].followUps[0].status).toBeNull();
  });

  it("should handle skip confirmation flow properly", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    // Request skip
    const reqPrompt = await doInstance.requestSkip();
    expect(reqPrompt.type).toBe("ask_skip_confirmation");

    // Decline skip -> stays on question
    const declinePrompt = await doInstance.confirmSkip({
      requestId: "req-confirm-1",
      confirmed: false,
    });
    expect(declinePrompt.type).toBe("question");
    expect(declinePrompt.text).toBe("How does React reconciliation work?");

    // Request skip again & confirm
    await doInstance.requestSkip();
    const confirmPrompt = await doInstance.confirmSkip({
      requestId: "req-confirm-2",
      confirmed: true,
      transcript: "Yes, skip it please.",
    });
    expect(confirmPrompt.type).toBe("question");
    expect(confirmPrompt.text).toBe("Explain how useMemo and useCallback differ.");
  });

  it("should return clarification hint without advancing cursor", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    const clarify = await doInstance.getClarification();
    expect(clarify.type).toBe("clarification");
    expect(clarify.text).toBe("Explain the virtual DOM diffing algorithm.");
    expect(clarify.cursor).toEqual({ questionIndex: 0, followUpIndex: null });

    const prompt = await doInstance.getCurrentPrompt();
    expect(prompt.cursor).toEqual({ questionIndex: 0, followUpIndex: null });
  });

  it("should allow explicit endSession to finalize interview", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    const end = await doInstance.endSession();
    expect(end.type).toBe("completed");
    expect(end.isComplete).toBe(true);

    const state = await doInstance.getState();
    expect(state?.interview.status).toBe("completed");
  });

  it("should repeat active prompt accurately via repeatPrompt", async () => {
    const session = createTestInterviewSession();
    await doInstance.initialize(session);

    const repeated = await doInstance.repeatPrompt();
    expect(repeated.type).toBe("question");
    expect(repeated.text).toBe("How does React reconciliation work?");
  });

  it("should time out session when alarm triggers after deadline", async () => {
    const session = createTestInterviewSession();
    session.interviewLengthSeconds = 1; // 1 second length
    await doInstance.initialize(session);

    // Fast-forward time
    const state = await doInstance.getState();
    if (state) {
      state.startedAtMs = Date.now() - 5000; // started 5s ago
    }

    await doInstance.alarm();

    const finalState = await doInstance.getState();
    expect(finalState?.interview.status).toBe("timed_out");
    expect(finalState?.cursor.questionIndex).toBe(session.questions.length);
  });
});

