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
