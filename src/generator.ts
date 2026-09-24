import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { InterviewSession } from "./types";

/**
 * Zod schemas defining the shape of generated interview sessions.
 */
export const GeneratedFollowUpSchema = z.object({
  id: z.string().describe("Unique follow-up ID, e.g. fu_1_1"),
  prompt: z.string().describe("Clean spoken follow-up question. MUST be directly spoken text with NO URLs, no markdown, no formatting."),
  clarify: z.string().nullable().describe("Helpful clarification text if the candidate asks for more information."),
  expectedAnswer: z.string().describe("Core technical rubric / key concepts expected in candidate's response."),
  timerSeconds: z.number().default(120).describe("Recommended time in seconds to answer this follow-up (e.g. 60-120)."),
});

export const GeneratedQuestionSchema = z.object({
  id: z.string().describe("Unique question ID, e.g. q_1"),
  prompt: z.string().describe("Clean spoken main question. MUST be conversational, direct, and ready for TTS audio synthesis (no raw URLs, no meta-prompts)."),
  clarify: z.string().nullable().describe("Helpful clarification text if candidate asks what the question means."),
  expectedAnswer: z.string().describe("Technical rubric / evaluation criteria for the interviewer."),
  timerSeconds: z.number().default(180).describe("Recommended time in seconds to answer this question (e.g. 120-240)."),
  followUps: z.array(GeneratedFollowUpSchema).default([]).describe("Optional deep-dive follow-up questions."),
});

export const GeneratedInterviewSchema = z.object({
  title: z.string().describe("Concise, descriptive title for the interview (e.g., 'React Native Architecture & Performance')"),
  opening: z.string().describe("A professional spoken welcome message from the interviewer introducing the track."),
  closing: z.string().describe("A professional closing message thanking the candidate when the interview finishes."),
  interviewLengthSeconds: z.number().default(900).describe("Total estimated interview duration in seconds."),
  questions: z.array(GeneratedQuestionSchema).min(1).describe("List of structured interview questions."),
});

export type GeneratedInterview = z.infer<typeof GeneratedInterviewSchema>;

export interface GenerateInterviewOptions {
  userPrompt: string;
  apiKey: string;
  targetCount?: number;
}

/**
 * Generates a structured interview template using Vercel AI SDK and Google Gemini.
 */
export async function generateInterviewTemplate(
  options: GenerateInterviewOptions
): Promise<InterviewSession> {
  const { userPrompt, apiKey, targetCount } = options;

  const google = createGoogleGenerativeAI({ apiKey });

  const systemPrompt = `
You are an expert technical interviewer and interview designer.
Your role is to create rigorous, structured, realistic voice interview templates based on user prompts.

CRITICAL VOICE & AUDIO RULES:
1. Every question prompt MUST be clean, natural, spoken English designed for audio Text-To-Speech (TTS).
2. NEVER include URLs, Markdown links, bullets, or meta-instructions inside the prompt strings.
3. If the user provided documentation links, extract the underlying concepts (e.g. Navigation, Testing, Reanimated, TurboModules, New Architecture, State Management) and write deep, practical questions testing those specific domains.
4. Each question should have:
   - A clear, direct 'prompt'
   - A helpful 'clarify' hint explaining the scope if the candidate is confused
   - An 'expectedAnswer' rubric detailing key architectural patterns, trade-offs, or code practices
   - Logical follow-ups ('followUps') that dive deeper into edge cases, scalability, or performance.
5. Create professional spoken 'opening' and 'closing' statements.
${targetCount ? `6. Produce exactly ${targetCount} main questions.` : ""}
`.trim();

  const { output } = await generateText({
    model: google("gemini-3.5-flash-lite"),
    output: Output.object({
      schema: GeneratedInterviewSchema,
    }),
    system: systemPrompt,
    prompt: userPrompt,
  });

  const timestamp = Date.now();
  const sessionId = `sess_${timestamp}`;
  const templateId = `tmpl_${timestamp}`;
  const groupId = `grp_${timestamp}`;

  // Map into full InterviewSession type
  const session: InterviewSession = {
    id: sessionId,
    templateId,
    attemptGroupId: groupId,
    attemptNumber: 1,
    retriedFromInterviewId: null,
    title: output.title,
    userPrompt,
    interviewLengthSeconds: output.interviewLengthSeconds || 900,
    totalTimeTakenSeconds: null,
    status: null,
    opening: output.opening,
    closing: output.closing,
    questions: output.questions.map((q, qIdx) => ({
      id: q.id || `q_${qIdx + 1}`,
      prompt: q.prompt,
      clarify: q.clarify || null,
      expectedAnswer: q.expectedAnswer,
      answer: null,
      timerSeconds: q.timerSeconds || 180,
      status: null,
      followUps: (q.followUps || []).map((fu, fuIdx) => ({
        id: fu.id || `fu_${qIdx + 1}_${fuIdx + 1}`,
        prompt: fu.prompt,
        clarify: fu.clarify || null,
        expectedAnswer: fu.expectedAnswer,
        answer: null,
        timerSeconds: fu.timerSeconds || 120,
        status: null,
      })),
    })),
  };

  return session;
}
