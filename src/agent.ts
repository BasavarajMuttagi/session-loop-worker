import { voice, llm } from "@livekit/agents";
import { z } from "zod";
import type { PromptResponse, InterviewSession } from "./types";

export type InterviewDetailsResponse = {
  record?: {
    id: string;
    title: string;
    status: string;
    candidateId: string;
    sessionData?: InterviewSession;
  };
  liveState?: {
    interview?: InterviewSession;
    cursor?: { questionIndex: number; followUpIndex: number | null };
    pendingSkipConfirmation?: { questionIndex: number; followUpIndex: number | null } | null;
  };
  error?: string;
};

export class SessionLoopClient {
  private baseUrl: string;
  private secret: string;

  constructor(
    baseUrl = process.env.WORKER_API_URL || "http://127.0.0.1:8787",
    secret = process.env.INTERNAL_SECRET || "session-loop-secret"
  ) {
    this.baseUrl = baseUrl;
    this.secret = secret;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      "x-internal-secret": this.secret,
      ...extra,
    };
  }

  async getInterview(interviewId: string): Promise<InterviewDetailsResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}`, {
      headers: this.headers(),
    });
    return (await res.json()) as InterviewDetailsResponse;
  }

  async getCurrentPrompt(interviewId: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/current-prompt`, {
      headers: this.headers(),
    });
    return res.json();
  }

  async submitAnswer(interviewId: string, transcript: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/answer`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        transcript,
      }),
    });
    return res.json();
  }

  async skipQuestion(interviewId: string, transcript?: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/skip`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        transcript,
      }),
    });
    return res.json();
  }

  async requestSkip(interviewId: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/skip/request`, {
      method: "POST",
      headers: this.headers(),
    });
    return res.json();
  }

  async confirmSkip(interviewId: string, confirmed: boolean, transcript?: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/skip/confirm`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        confirmed,
        transcript,
      }),
    });
    return res.json();
  }

  async getClarification(interviewId: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/clarify`, {
      headers: this.headers(),
    });
    return res.json();
  }

  async repeatPrompt(interviewId: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/repeat`, {
      headers: this.headers(),
    });
    return res.json();
  }

  async endSession(interviewId: string): Promise<PromptResponse> {
    const res = await fetch(`${this.baseUrl}/api/interviews/${interviewId}/end`, {
      method: "POST",
      headers: this.headers(),
    });
    return res.json();
  }
}

export function createInterviewAgent(
  loopClient: SessionLoopClient,
  interviewId: string,
  session: InterviewSession,
  initialPrompt: string,
  onSessionComplete?: (closingRemarks: string) => void | Promise<void>,
  onStateUpdate?: (promptRes: PromptResponse) => void | Promise<void>
) {
  const tools = {
    submitAnswer: llm.tool({
      description:
        "Submit the candidate's answer for the current question or follow-up. You MUST ONLY call this when the candidate has actually provided their substantive answer, NOT on single words, fillers, pauses, or skip requests.",
      parameters: z.object({
        transcript: z.string().describe("The candidate's spoken answer transcript"),
      }),
      execute: async ({ transcript }) => {
        const clean = transcript.trim();
        const lowerClean = clean.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

        // Check if candidate actually asked to skip
        const isSkip =
          lowerClean === "skip" ||
          lowerClean === "uh skip" ||
          lowerClean === "uhh skip" ||
          lowerClean === "um skip" ||
          lowerClean === "pass" ||
          lowerClean === "next question" ||
          lowerClean === "skip question" ||
          lowerClean === "skip this question" ||
          lowerClean === "skip this" ||
          lowerClean.startsWith("skip ") ||
          lowerClean.endsWith(" skip");

        if (isSkip) {
          const res = await loopClient.skipQuestion(interviewId, clean);
          await onStateUpdate?.(res);
          if (res.isComplete) {
            onSessionComplete?.(res.text);
            return `The interview is now COMPLETE. Speak these closing remarks warmly and clearly to the candidate: "${res.text}". Do not ask any further questions.`;
          }
          return `Question skipped. Now speak the next question to the candidate: "${res.text}".`;
        }

        const words = clean.split(/\s+/).filter(Boolean);
        const fillers = ["um", "uh", "yeah", "yes", "okay", "ok", "well", "sure", "wait", "hmm", "thinking", "so", "right"];
        
        // If candidate only said 1-2 words that are hesitations/fillers, DO NOT advance
        if (words.length <= 2 && fillers.some(f => clean.toLowerCase().includes(f))) {
          return "The candidate only uttered a hesitation or filler word ('" + clean + "'). DO NOT advance the question. Speak gently: 'Take your time, I am listening.' and wait for their actual answer.";
        }

        const res = await loopClient.submitAnswer(interviewId, transcript);
        await onStateUpdate?.(res);
        if (res.isComplete) {
          onSessionComplete?.(res.text);
          return `The interview is now COMPLETE. Speak these closing remarks warmly and clearly to the candidate: "${res.text}". Do not ask any further questions.`;
        }
        return `Answer recorded successfully. Now speak the next question to the candidate: "${res.text}".`;
      },
    }),

    skipQuestion: llm.tool({
      description:
        "Skip the current question or follow-up when the candidate asks to skip (e.g. 'skip', 'uhh skip', 'can we skip this', 'next question', 'pass'). Pass their exact spoken words as transcript.",
      parameters: z.object({
        transcript: z.string().describe("The candidate's spoken words when asking to skip, e.g. 'uhh skip'"),
      }),
      execute: async ({ transcript }) => {
        const res = await loopClient.skipQuestion(interviewId, transcript);
        await onStateUpdate?.(res);
        if (res.isComplete) {
          onSessionComplete?.(res.text);
          return `The interview is now COMPLETE. Speak these closing remarks warmly and clearly to the candidate: "${res.text}". Do not ask any further questions.`;
        }
        return `Question skipped. Now speak the next question to the candidate: "${res.text}".`;
      },
    }),

    getClarification: llm.tool({
      description:
        "Get the clarification text when the candidate asks for clarification or does not understand the question.",
      parameters: z.object({}),
      execute: async () => {
        const res = await loopClient.getClarification(interviewId);
        return `Speak this clarification to the candidate: "${res.text}".`;
      },
    }),

    repeatQuestion: llm.tool({
      description:
        "Repeat the current question when the candidate asks you to repeat it.",
      parameters: z.object({}),
      execute: async () => {
        const res = await loopClient.repeatPrompt(interviewId);
        return `Repeat this prompt to the candidate: "${res.text}".`;
      },
    }),

    requestSkip: llm.tool({
      description:
        "Initiate a skip request if you want to confirm before skipping.",
      parameters: z.object({}),
      execute: async () => {
        const res = await loopClient.requestSkip(interviewId);
        return `Ask the candidate: "${res.text}".`;
      },
    }),

    confirmSkip: llm.tool({
      description:
        "Confirm or decline skipping the question after asking the candidate for confirmation.",
      parameters: z.object({
        confirmed: z.boolean().describe("True if candidate confirmed 'yes', false if 'no'"),
        transcript: z.string().optional().describe("The candidate's spoken confirmation"),
      }),
      execute: async ({ confirmed, transcript }) => {
        const res = await loopClient.confirmSkip(interviewId, confirmed, transcript);
        await onStateUpdate?.(res);
        if (res.isComplete) {
          onSessionComplete?.(res.text);
          return `The interview is now COMPLETE. Speak these closing remarks warmly and clearly to the candidate: "${res.text}". Do not ask any further questions.`;
        }
        return `Skip resolved. Now ask the candidate the active question: "${res.text}".`;
      },
    }),
  };

  const questionsSummary = session.questions
    .map(
      (q, idx) =>
        `${idx + 1}. Main Question: "${q.prompt}" (Follow-ups: ${q.followUps?.length || 0})`
    )
    .join("\n");

  const instructions = `
You are the professional AI interviewer conducting the "${session.title}".

CRITICAL LISTENING & TURN-TAKING RULES:
1. Listen patiently to the candidate. In a real technical interview, candidates frequently pause to think, formulate their architecture, or start by saying "Um...", "Well...", "Let me see...", or "I think...".
2. DO NOT cut off the candidate or call 'submitAnswer' if they only said a single word or hesitation filler.
3. ONLY call 'submitAnswer' when the candidate has finished providing their complete, substantive technical answer or explicitly says they are done.
4. If the candidate asks for clarification, call 'getClarification' and read it aloud.
5. If the candidate asks to repeat the question, call 'repeatQuestion' and repeat it aloud.
6. If the candidate asks to skip (e.g. "skip", "uhh skip", "skip this", "can we skip this", "next question", "pass"), call 'skipQuestion' with their exact spoken words as transcript. DO NOT paraphrase or replace their words with canned text.
7. When all questions are completed, speak the closing remarks: "${session.closing}".
8. The initial question you must ask is: "${initialPrompt}".

Interview Track Structure:
${questionsSummary}
  `.trim();

  return voice.Agent.create({
    instructions,
    tools,
  });
}