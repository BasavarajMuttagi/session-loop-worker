import { DurableObject } from "cloudflare:workers";
import type {
  InterviewDOState,
  InterviewSession,
  PromptResponse,
  Question,
  FollowUp,
  Env,
} from "../types";

/**
 * Pure State Machine Durable Object for Interview Sessions.
 *
 * Guarantees:
 * 1. Single-writer consistency and atomic persistence.
 * 2. Strict 1-by-1 question progression (questions -> follow-ups -> next question).
 * 3. Exact transcript capture for answers and skips.
 * 4. Idempotency against duplicate network request submissions.
 * 5. Complete state recovery on restart.
 */
export class InterviewSessionDO extends DurableObject<Env> {
  private static readonly STORAGE_KEY = "interview_state";
  private stateCache: InterviewDOState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Retrieves the current persisted DO state.
   */
  async getState(): Promise<InterviewDOState | null> {
    if (this.stateCache) {
      return this.stateCache;
    }
    const stored = await this.ctx.storage.get<InterviewDOState>(
      InterviewSessionDO.STORAGE_KEY
    );
    this.stateCache = stored || null;
    return this.stateCache;
  }

  /**
   * Initializes a new interview session.
   * If already initialized, safely returns the active prompt without overriding state.
   */
  async initialize(interview: InterviewSession): Promise<PromptResponse> {
    const existing = await this.getState();
    if (existing) {
      return this.formatPromptResponse(existing);
    }

    const state: InterviewDOState = {
      schemaVersion: 1,
      interview: {
        ...interview,
        status: "in_progress",
      },
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

    this.stateCache = state;
    await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);

    // Schedule total interview timeout alarm
    const startedAtMs = state.startedAtMs ?? Date.now();
    const deadlineMs = startedAtMs + state.interview.interviewLengthSeconds * 1000;
    await this.ctx.storage.setAlarm(deadlineMs);

    return this.formatPromptResponse(state);
  }

  /**
   * Returns the currently active prompt to be spoken or displayed.
   */
  async getCurrentPrompt(): Promise<PromptResponse> {
    const state = await this.getState();
    if (!state) {
      throw new Error("Interview session not initialized");
    }
    return this.formatPromptResponse(state);
  }

  /**
   * Submits a candidate's answer and advances the state machine.
   */
  async submitAnswer(input: {
    requestId: string;
    transcript: string;
  }): Promise<PromptResponse> {
    const state = await this.getState();
    if (!state) {
      throw new Error("Interview session not initialized");
    }

    // Idempotency check: duplicate request returns current prompt without re-advancing
    if (state.processedRequestIds.includes(input.requestId)) {
      return this.formatPromptResponse(state);
    }

    const question = this.getCurrentQuestion(state);
    if (!question) {
      return this.formatPromptResponse(state);
    }

    const cleanTranscript = input.transcript.trim();

    if (state.cursor.followUpIndex === null) {
      // Answering main question
      question.answer = cleanTranscript;
      question.status = "answered";

      // Transition to first follow-up if available, otherwise advance to next question
      if (question.followUps && question.followUps.length > 0) {
        state.cursor.followUpIndex = 0;
      } else {
        state.cursor.questionIndex += 1;
        state.cursor.followUpIndex = null;
      }
    } else {
      // Answering follow-up question
      const followUp = question.followUps[state.cursor.followUpIndex];
      if (followUp) {
        followUp.answer = cleanTranscript;
        followUp.status = "answered";
      }

      const nextFollowUpIndex = state.cursor.followUpIndex + 1;
      if (nextFollowUpIndex < question.followUps.length) {
        state.cursor.followUpIndex = nextFollowUpIndex;
      } else {
        state.cursor.questionIndex += 1;
        state.cursor.followUpIndex = null;
      }
    }

    state.pendingSkipConfirmation = null;
    this.completeIfNeeded(state);
    this.recordProcessedRequestId(state, input.requestId);
    state.updatedAtMs = Date.now();
    state.revision += 1;

    this.stateCache = state;
    await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);

    return this.formatPromptResponse(state);
  }

  /**
   * Directly skips the active question or follow-up, saving candidate's exact words.
   */
  async skip(input: {
    requestId: string;
    transcript?: string;
  }): Promise<PromptResponse> {
    const state = await this.getState();
    if (!state) {
      throw new Error("Interview session not initialized");
    }

    if (state.processedRequestIds.includes(input.requestId)) {
      return this.formatPromptResponse(state);
    }

    this.skipActiveItem(state, input.transcript);
    state.pendingSkipConfirmation = null;
    this.completeIfNeeded(state);
    this.recordProcessedRequestId(state, input.requestId);
    state.updatedAtMs = Date.now();
    state.revision += 1;

    this.stateCache = state;
    await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);

    return this.formatPromptResponse(state);
  }

  /**
   * Requests a confirmation prompt before skipping.
   */
  async requestSkip(): Promise<PromptResponse> {
    const state = await this.getState();
    if (!state) {
      throw new Error("Interview session not initialized");
    }

    state.pendingSkipConfirmation = {
      questionIndex: state.cursor.questionIndex,
      followUpIndex: state.cursor.followUpIndex,
    };
    state.updatedAtMs = Date.now();
    state.revision += 1;

    this.stateCache = state;
    await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);

    return this.formatPromptResponse(state);
  }

  /**
   * Confirms or declines a pending skip.
   */
  async confirmSkip(input: {
    requestId: string;
    confirmed: boolean;
    transcript?: string;
  }): Promise<PromptResponse> {
    const state = await this.getState();
    if (!state) {
      throw new Error("Interview session not initialized");
    }

    if (state.processedRequestIds.includes(input.requestId)) {
      return this.formatPromptResponse(state);
    }

    const pending = state.pendingSkipConfirmation;
    if (!pending) {
      if (input.confirmed) {
        return this.skip(input);
      }
      return this.formatPromptResponse(state);
    }

    if (!input.confirmed) {
      // Candidate declined skip -> stay on current question
      state.pendingSkipConfirmation = null;
      this.recordProcessedRequestId(state, input.requestId);
      state.updatedAtMs = Date.now();
      state.revision += 1;
      this.stateCache = state;
      await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);
      return this.formatPromptResponse(state);
    }

    // Candidate confirmed skip
    this.skipActiveItem(state, input.transcript);
    state.pendingSkipConfirmation = null;
    this.completeIfNeeded(state);
    this.recordProcessedRequestId(state, input.requestId);
    state.updatedAtMs = Date.now();
    state.revision += 1;

    this.stateCache = state;
    await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);
    return this.formatPromptResponse(state);
  }

  /**
   * Clarification query.
   */
  async getClarification(): Promise<PromptResponse> {
    const state = await this.getState();
    if (!state) {
      throw new Error("Interview session not initialized");
    }

    const currentItem = this.getCurrentItem(state);
    if (!currentItem) {
      return this.formatPromptResponse(state);
    }

    const clarification =
      currentItem.clarify?.trim() ||
      "Please explain your approach and reasoning. You can make reasonable assumptions.";

    return {
      type: "clarification",
      text: clarification,
      itemId: currentItem.id,
      cursor: state.cursor,
      interviewStatus: state.interview.status,
      timerSeconds: currentItem.timerSeconds,
      isComplete: false,
    };
  }

  /**
   * Repeat active prompt query.
   */
  async repeatPrompt(): Promise<PromptResponse> {
    return this.getCurrentPrompt();
  }

  /**
   * Ends the interview session explicitly and finalizes the state.
   */
  async endSession(): Promise<PromptResponse> {
    const state = await this.getState();
    if (!state) {
      throw new Error("Interview session not initialized");
    }

    state.interview.status = "completed";
    if (state.startedAtMs) {
      state.interview.totalTimeTakenSeconds = Math.max(
        0,
        Math.floor((Date.now() - state.startedAtMs) / 1000)
      );
    }
    state.cursor.questionIndex = state.interview.questions.length;
    state.cursor.followUpIndex = null;
    state.pendingSkipConfirmation = null;
    state.updatedAtMs = Date.now();
    state.revision += 1;

    this.stateCache = state;
    await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);
    return this.formatPromptResponse(state);
  }

  /**
   * Alarm handler for total interview timeout.
   */
  async alarm(): Promise<void> {
    const state = await this.getState();
    if (!state || state.interview.status === "completed") {
      return;
    }

    const startedAtMs = state.startedAtMs ?? Date.now();
    const deadlineMs =
      startedAtMs + state.interview.interviewLengthSeconds * 1000;

    if (Date.now() < deadlineMs) {
      await this.ctx.storage.setAlarm(deadlineMs);
      return;
    }

    state.interview.status = "timed_out";
    state.interview.totalTimeTakenSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAtMs) / 1000)
    );
    state.cursor.questionIndex = state.interview.questions.length;
    state.cursor.followUpIndex = null;
    state.pendingSkipConfirmation = null;
    state.updatedAtMs = Date.now();
    state.revision += 1;

    this.stateCache = state;
    await this.ctx.storage.put(InterviewSessionDO.STORAGE_KEY, state);
  }

  // --- Private Helper Methods ---

  private getCurrentQuestion(state: InterviewDOState): Question | null {
    return state.interview.questions[state.cursor.questionIndex] ?? null;
  }

  private getCurrentItem(
    state: InterviewDOState
  ): Question | FollowUp | null {
    const question = this.getCurrentQuestion(state);
    if (!question) return null;

    if (state.cursor.followUpIndex === null) {
      return question;
    }

    return question.followUps[state.cursor.followUpIndex] ?? null;
  }

  private isInterviewComplete(state: InterviewDOState): boolean {
    return state.cursor.questionIndex >= state.interview.questions.length;
  }

  private completeIfNeeded(state: InterviewDOState) {
    if (this.isInterviewComplete(state)) {
      state.interview.status = "completed";
      if (state.startedAtMs) {
        state.interview.totalTimeTakenSeconds = Math.max(
          0,
          Math.floor((Date.now() - state.startedAtMs) / 1000)
        );
      }
      state.cursor.followUpIndex = null;
    }
  }

  private skipActiveItem(state: InterviewDOState, transcript?: string) {
    const question = this.getCurrentQuestion(state);
    if (!question) return;

    const recordedAnswer = transcript?.trim() || "Skipped";

    if (state.cursor.followUpIndex === null) {
      // Main question skip -> record candidate's exact words
      question.answer = recordedAnswer;
      question.status = "skipped";

      // Leave follow-ups unasked so they are never leaked
      for (const followUp of question.followUps) {
        if (followUp.status === null) {
          followUp.status = null;
          followUp.answer = null;
        }
      }

      state.cursor.questionIndex += 1;
      state.cursor.followUpIndex = null;
    } else {
      // Follow-up skip -> skip only this follow-up with candidate's exact words
      const followUp = question.followUps[state.cursor.followUpIndex];
      if (followUp) {
        followUp.answer = recordedAnswer;
        followUp.status = "skipped";
      }

      const nextFollowUpIndex = state.cursor.followUpIndex + 1;
      if (nextFollowUpIndex < question.followUps.length) {
        state.cursor.followUpIndex = nextFollowUpIndex;
      } else {
        state.cursor.questionIndex += 1;
        state.cursor.followUpIndex = null;
      }
    }
  }

  private recordProcessedRequestId(state: InterviewDOState, requestId: string) {
    state.processedRequestIds.push(requestId);
    if (state.processedRequestIds.length > 100) {
      state.processedRequestIds = state.processedRequestIds.slice(-100);
    }
  }

  private formatPromptResponse(state: InterviewDOState): PromptResponse {
    if (this.isInterviewComplete(state)) {
      return {
        type: "completed",
        text:
          state.interview.closing ||
          "Thank you for completing the interview. Your session is now closed.",
        cursor: state.cursor,
        interviewStatus: state.interview.status ?? "completed",
        isComplete: true,
      };
    }

    if (state.pendingSkipConfirmation) {
      return {
        type: "ask_skip_confirmation",
        text: "Would you like to skip this question?",
        cursor: state.cursor,
        interviewStatus: state.interview.status,
        isComplete: false,
      };
    }

    const currentItem = this.getCurrentItem(state);
    if (!currentItem) {
      return {
        type: "completed",
        text: state.interview.closing,
        cursor: state.cursor,
        interviewStatus: state.interview.status ?? "completed",
        isComplete: true,
      };
    }

    const isMain = state.cursor.followUpIndex === null;
    return {
      type: isMain ? "question" : "follow_up",
      text: currentItem.prompt,
      itemId: currentItem.id,
      cursor: state.cursor,
      interviewStatus: state.interview.status,
      timerSeconds: currentItem.timerSeconds,
      isComplete: false,
    };
  }
}
