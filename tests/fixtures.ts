import type { InterviewSession } from "../src/types";

export function createTestInterviewSession(id = "sess_test_1"): InterviewSession {
  return {
    id,
    templateId: "tmpl_test_1",
    attemptGroupId: "grp_test_1",
    attemptNumber: 1,
    retriedFromInterviewId: null,
    title: "React Architecture Interview",
    userPrompt: "Senior React Engineer",
    interviewLengthSeconds: 600,
    totalTimeTakenSeconds: null,
    status: null,
    opening: "Welcome to your React technical interview. Let us begin.",
    closing: "Thank you for completing the interview. Your session is now closed.",
    questions: [
      {
        id: "q_1",
        prompt: "How does React reconciliation work?",
        clarify: "Explain the virtual DOM diffing algorithm.",
        expectedAnswer: "Fiber tree, diffing by key and component type.",
        answer: null,
        timerSeconds: 120,
        status: null,
        followUps: [
          {
            id: "fu_1_1",
            prompt: "What are the trade-offs of using array index as key?",
            clarify: "Think about reordering or filtering lists.",
            expectedAnswer: "Causes unnecessary re-renders and potential state bugs.",
            answer: null,
            timerSeconds: 60,
            status: null,
          },
        ],
      },
      {
        id: "q_2",
        prompt: "Explain how useMemo and useCallback differ.",
        clarify: "Focus on caching computed values vs function references.",
        expectedAnswer: "useMemo caches values; useCallback caches functions.",
        answer: null,
        timerSeconds: 120,
        status: null,
        followUps: [],
      },
    ],
  };
}
