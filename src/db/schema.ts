import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { InterviewSession } from "../types";

export const interviewAttempts = sqliteTable("interview_attempts", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull(),
  attemptGroupId: text("attempt_group_id").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  retriedFromInterviewId: text("retried_from_interview_id"),
  candidateId: text("candidate_id").notNull(),
  title: text("title").notNull(),
  userPrompt: text("user_prompt").notNull(),
  interviewLengthSeconds: integer("interview_length_seconds").notNull(),
  totalTimeTakenSeconds: integer("total_time_taken_seconds"),
  status: text("status", { enum: ["in_progress", "completed", "timed_out"] })
    .notNull()
    .default("in_progress"),
  sessionData: text("session_data", { mode: "json" }).$type<InterviewSession>(),
  createdAt: text("created_at")
    .default(sql`(CURRENT_TIMESTAMP)`)
    .notNull(),
  completedAt: text("completed_at"),
});

export type InterviewAttemptRecord = typeof interviewAttempts.$inferSelect;
export type NewInterviewAttempt = typeof interviewAttempts.$inferInsert;
