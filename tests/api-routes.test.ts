import { describe, it, expect } from "vitest";
import app from "../src/index";
import { createMockEnv } from "./mock-env";
import { createTestInterviewSession } from "./fixtures";

describe("Hono API Routes (https://hono.dev/docs/guides/testing)", () => {
  it("GET /health should return status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; timestamp: number }>();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("number");
  });

  describe("Validation & Guardrails", () => {
    it("POST /api/interviews/generate should reject invalid payload with 400", async () => {
      const env = createMockEnv();
      const res = await app.request(
        "/api/interviews/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "ab" }), // Min 3 chars required
        },
        env
      );

      expect(res.status).toBe(400);
      const body = await res.json<{ success: boolean; error: string }>();
      expect(body.success).toBe(false);
      expect(body.error).toBe("Validation failed");
    });

    it("POST /api/interviews/generate should reject unauthenticated requests with 401", async () => {
      const env = createMockEnv();
      const res = await app.request(
        "/api/interviews/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "Valid Senior React Interview Prompt" }),
        },
        env
      );

      expect(res.status).toBe(401);
      const body = await res.json<{ success: boolean; error: string }>();
      expect(body.success).toBe(false);
    });

    it("POST /api/interviews/:id/answer should reject empty request with 400", async () => {
      const env = createMockEnv();
      const res = await app.request(
        "/api/interviews/sess_123/answer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        env
      );

      expect(res.status).toBe(400);
      const body = await res.json<{ success: boolean; error: string }>();
      expect(body.success).toBe(false);
    });
  });

  describe("Active Session Loop Endpoints", () => {
    const sessionId = "sess_integration_1";
    const testSession = createTestInterviewSession(sessionId);

    it("GET /api/interviews/:id/current-prompt should return the active question", async () => {
      const env = createMockEnv({ [sessionId]: testSession });
      const res = await app.request(
        `/api/interviews/${sessionId}/current-prompt`,
        {},
        env
      );

      expect(res.status).toBe(200);
      const body = await res.json<any>();
      expect(body.type).toBe("question");
      expect(body.text).toBe("How does React reconciliation work?");
    });

    it("POST /api/interviews/:id/answer should record answer and advance prompt", async () => {
      const env = createMockEnv({ [sessionId]: testSession });
      const res = await app.request(
        `/api/interviews/${sessionId}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: "req-answer-1",
            transcript: "React compares virtual DOM nodes using element key and type.",
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const body = await res.json<any>();
      expect(body.type).toBe("follow_up");
      expect(body.text).toBe("What are the trade-offs of using array index as key?");
    });

    it("GET /api/interviews/:id/clarify should return clarification hint", async () => {
      const env = createMockEnv({ [sessionId]: testSession });
      const res = await app.request(
        `/api/interviews/${sessionId}/clarify`,
        {},
        env
      );

      expect(res.status).toBe(200);
      const body = await res.json<any>();
      expect(body.type).toBe("clarification");
      expect(body.text).toBe("Explain the virtual DOM diffing algorithm.");
    });

    it("POST /api/interviews/:id/skip should skip the current item", async () => {
      const env = createMockEnv({ [sessionId]: testSession });
      const res = await app.request(
        `/api/interviews/${sessionId}/skip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: "req-skip-direct",
            transcript: "Let's skip this question.",
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const body = await res.json<any>();
      expect(body.type).toBe("question");
      expect(body.text).toBe("Explain how useMemo and useCallback differ.");
    });

    it("POST /api/interviews/:id/end should conclude the session", async () => {
      const env = createMockEnv({ [sessionId]: testSession });
      const res = await app.request(
        `/api/interviews/${sessionId}/end`,
        { method: "POST" },
        env
      );

      expect(res.status).toBe(200);
      const body = await res.json<any>();
      expect(body.type).toBe("completed");
      expect(body.isComplete).toBe(true);
    });

    it("POST /api/interviews/:id/token should generate a LiveKit participant token", async () => {
      const env = createMockEnv();
      const res = await app.request(
        `/api/interviews/${sessionId}/token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "user_cand_123",
          },
          body: JSON.stringify({
            userName: "Alice Candidate",
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const body = await res.json<any>();
      expect(body.room).toBe(sessionId);
      expect(body.identity).toBe("user_cand_123");
      expect(typeof body.token).toBe("string");
      expect(body.token.split(".").length).toBe(3); // Valid JWT format
    });
  });
});
