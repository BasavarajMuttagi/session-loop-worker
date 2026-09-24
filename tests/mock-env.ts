import { createMockDOState } from "./mock-do";
import { InterviewSessionDO } from "../src/durable-objects/InterviewSessionDO";
import type { Env, InterviewSession } from "../src/types";

export function createMockEnv(initialSessions: Record<string, InterviewSession> = {}): Env {
  const doMap = new Map<string, InterviewSessionDO>();
  const dbRows: any[] = [];

  // Mock D1
  const mockD1 = {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        all: async () => ({ results: dbRows }),
        first: async () => dbRows[0] || null,
        run: async () => ({ success: true }),
      }),
      all: async () => ({ results: dbRows }),
      first: async () => dbRows[0] || null,
      run: async () => ({ success: true }),
    }),
    batch: async (statements: any[]) => [],
    exec: async (query: string) => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;

  // Mock DO Namespace
  const mockDONamespace = {
    idFromName: (name: string) => ({
      toString: () => name,
      equals: () => true,
    }),
    get: (id: { toString: () => string }) => {
      const name = id.toString();
      if (!doMap.has(name)) {
        const mockState = createMockDOState();
        if (initialSessions[name]) {
          const session = initialSessions[name];
          const state = {
            schemaVersion: 1,
            interview: { ...session, status: "in_progress" },
            cursor: { questionIndex: 0, followUpIndex: null },
            pendingSkipConfirmation: null,
            startedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            revision: 1,
            processedRequestIds: [],
          };
          mockState.store.set("interview_state", state);
        }
        const doInst = new InterviewSessionDO(mockState.ctx, {} as Env);
        doMap.set(name, doInst);
      }
      return doMap.get(name)!;
    },
  } as unknown as DurableObjectNamespace<InterviewSessionDO>;

  return {
    DB: mockD1,
    INTERVIEW_SESSION: mockDONamespace,
    GOOGLE_API_KEY: "mock-google-key",
    LIVEKIT_API_KEY: "mock-livekit-key",
    LIVEKIT_API_SECRET: "mock-livekit-secret-key-32-chars-long!",
  };
}
