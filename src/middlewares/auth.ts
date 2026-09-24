import type { Context } from "hono";
import { getAuth } from "@clerk/hono";

/**
 * Extracts candidate ID from Clerk authentication, with graceful fallback for development/tests.
 */
export async function getCandidateId(c: Context): Promise<string | null> {
  try {
    const auth = getAuth(c);
    if (auth?.userId) {
      return auth.userId;
    }
  } catch {
    // Non-Clerk / development request
  }

  // Fallback to query, header, or body in development/test
  const queryUserId = c.req.query("userId");
  if (queryUserId) return queryUserId;

  const headerUserId = c.req.header("x-user-id");
  if (headerUserId) return headerUserId;

  return null;
}

/**
 * Checks if request is an authenticated internal call from the LiveKit agent runner.
 */
export function isInternalAgentRequest(c: Context): boolean {
  const secretHeader = c.req.header("x-internal-secret");
  const expectedSecret =
    (c.env as any)?.INTERNAL_SECRET ||
    process.env.INTERNAL_SECRET ||
    "session-loop-secret";
  return !!secretHeader && secretHeader === expectedSecret;
}

