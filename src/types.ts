import { z } from "zod";

export const ItemStatusSchema = z.enum(["answered", "skipped"]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const InterviewStatusSchema = z.enum(["in_progress", "completed", "timed_out"]);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

export const FollowUpSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  clarify: z.string().nullable(),
  expectedAnswer: z.string(),
  answer: z.string().nullable(),
  timerSeconds: z.number(),
  status: ItemStatusSchema.nullable(),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  clarify: z.string().nullable(),
  expectedAnswer: z.string(),
  answer: z.string().nullable(),
  timerSeconds: z.number(),
  status: ItemStatusSchema.nullable(),
  followUps: z.array(FollowUpSchema),
});
export type Question = z.infer<typeof QuestionSchema>;

export const InterviewSessionSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  attemptGroupId: z.string(),
  attemptNumber: z.number().int().positive(),
  retriedFromInterviewId: z.string().nullable(),
  title: z.string(),
  userPrompt: z.string(),
  interviewLengthSeconds: z.number().int().positive(),
  totalTimeTakenSeconds: z.number().int().nullable(),
  status: InterviewStatusSchema.nullable(),
  opening: z.string(),
  closing: z.string(),
  questions: z.array(QuestionSchema),
});
export type InterviewSession = z.infer<typeof InterviewSessionSchema>;

export const InterviewCursorSchema = z.object({
  questionIndex: z.number().int().nonnegative(),
  followUpIndex: z.number().int().nonnegative().nullable(),
});
export type InterviewCursor = z.infer<typeof InterviewCursorSchema>;

export const PendingSkipConfirmationSchema = z
  .object({
    questionIndex: z.number().int().nonnegative(),
    followUpIndex: z.number().int().nonnegative().nullable(),
  })
  .nullable();
export type PendingSkipConfirmation = z.infer<typeof PendingSkipConfirmationSchema>;

export const InterviewDOStateSchema = z.object({
  schemaVersion: z.literal(1),
  interview: InterviewSessionSchema,
  cursor: InterviewCursorSchema,
  pendingSkipConfirmation: PendingSkipConfirmationSchema,
  startedAtMs: z.number().nullable(),
  updatedAtMs: z.number(),
  revision: z.number(),
  processedRequestIds: z.array(z.string()),
});
export type InterviewDOState = z.infer<typeof InterviewDOStateSchema>;

export const PromptResponseTypeSchema = z.enum([
  "question",
  "follow_up",
  "clarification",
  "ask_skip_confirmation",
  "completed",
]);
export type PromptResponseType = z.infer<typeof PromptResponseTypeSchema>;

export const PromptResponseSchema = z.object({
  type: PromptResponseTypeSchema,
  text: z.string(),
  itemId: z.string().optional(),
  cursor: InterviewCursorSchema,
  interviewStatus: InterviewStatusSchema.nullable(),
  timerSeconds: z.number().optional(),
  isComplete: z.boolean(),
});
export type PromptResponse = z.infer<typeof PromptResponseSchema>;

// --- Real-time Data Channel Protocol ---

export const RealtimeChatTurnMessageSchema = z.object({
  type: z.literal("chat_turn"),
  id: z.string(),
  from: z.enum(["assistant", "user"]),
  text: z.string(),
  timestamp: z.number(),
  sequence: z.number(),
});
export type RealtimeChatTurnMessage = z.infer<typeof RealtimeChatTurnMessageSchema>;

export const RealtimeLiveTranscriptMessageSchema = z.object({
  type: z.literal("live_transcript"),
  transcript: z.string(),
  isFinal: z.boolean(),
});
export type RealtimeLiveTranscriptMessage = z.infer<typeof RealtimeLiveTranscriptMessageSchema>;

export const RealtimeStateUpdateMessageSchema = z.object({
  type: z.literal("state_update"),
  cursor: InterviewCursorSchema,
  status: InterviewStatusSchema.nullable(),
  activePrompt: z.string().optional(),
  isComplete: z.boolean(),
  totalQuestions: z.number().int().nonnegative(),
  revision: z.number(),
});
export type RealtimeStateUpdateMessage = z.infer<typeof RealtimeStateUpdateMessageSchema>;

export const RealtimeSessionCompletedMessageSchema = z.object({
  type: z.literal("session_completed"),
  totalTimeTakenSeconds: z.number().optional(),
});
export type RealtimeSessionCompletedMessage = z.infer<typeof RealtimeSessionCompletedMessageSchema>;

export const RealtimeDataMessageSchema = z.discriminatedUnion("type", [
  RealtimeChatTurnMessageSchema,
  RealtimeLiveTranscriptMessageSchema,
  RealtimeStateUpdateMessageSchema,
  RealtimeSessionCompletedMessageSchema,
]);
export type RealtimeDataMessage = z.infer<typeof RealtimeDataMessageSchema>;



// --- Request Validation Schemas ---

export const CreateInterviewRequestSchema = z.object({
  session: InterviewSessionSchema,
  userId: z.string().optional(),
});
export type CreateInterviewRequest = z.infer<typeof CreateInterviewRequestSchema>;

export const GenerateInterviewRequestSchema = z.object({
  prompt: z.string().min(3, "Prompt must be at least 3 characters"),
  targetCount: z.number().int().min(1).max(20).optional(),
  userId: z.string().optional(),
});
export type GenerateInterviewRequest = z.infer<typeof GenerateInterviewRequestSchema>;

export const SubmitAnswerRequestSchema = z.object({
  requestId: z.string().min(1, "requestId is required"),
  transcript: z.string().min(1, "transcript is required"),
});
export type SubmitAnswerRequest = z.infer<typeof SubmitAnswerRequestSchema>;

export const SkipRequestSchema = z.object({
  requestId: z.string().optional(),
  transcript: z.string().optional(),
});
export type SkipRequest = z.infer<typeof SkipRequestSchema>;

export const ConfirmSkipRequestSchema = z.object({
  requestId: z.string().min(1, "requestId is required"),
  confirmed: z.boolean(),
  transcript: z.string().optional(),
});
export type ConfirmSkipRequest = z.infer<typeof ConfirmSkipRequestSchema>;

export const RetryInterviewRequestSchema = z.object({
  newSessionId: z.string().min(1, "newSessionId is required"),
  userId: z.string().optional(),
});
export type RetryInterviewRequest = z.infer<typeof RetryInterviewRequestSchema>;

export const LiveKitTokenRequestSchema = z.object({
  userId: z.string().optional(),
  userName: z.string().optional(),
});
export type LiveKitTokenRequest = z.infer<typeof LiveKitTokenRequestSchema>;

export type Env = {
  DB: D1Database;
  INTERVIEW_SESSION: DurableObjectNamespace<import("./durable-objects/InterviewSessionDO").InterviewSessionDO>;
  GOOGLE_API_KEY?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  WORKER_API_URL?: string;
};
