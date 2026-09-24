import type { InterviewDOState } from "../src/types";

export function createMockDOState() {
  const store = new Map<string, any>();
  let alarmMs: number | null = null;

  const storage = {
    get: async <T>(key: string): Promise<T | undefined> => store.get(key),
    put: async (key: string, value: any): Promise<void> => {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    delete: async (key: string): Promise<boolean> => store.delete(key),
    setAlarm: async (time: number): Promise<void> => {
      alarmMs = time;
    },
    getAlarm: async (): Promise<number | null> => alarmMs,
    deleteAlarm: async (): Promise<void> => {
      alarmMs = null;
    },
  };

  const ctx = {
    storage,
    id: { toString: () => "mock-do-id" },
    waitUntil: (promise: Promise<any>) => promise,
    blockConcurrencyWhile: async (fn: () => Promise<any>) => fn(),
  } as unknown as DurableObjectState;

  return { ctx, storage, store, getAlarmMs: () => alarmMs };
}
