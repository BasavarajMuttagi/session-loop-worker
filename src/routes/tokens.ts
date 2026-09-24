import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { AccessToken } from "livekit-server-sdk";
import { LiveKitTokenRequestSchema, type Env } from "../types";
import { getCandidateId } from "../middlewares/auth";

export const tokensRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/interviews/:id/token
 * Generates a signed LiveKit participant token.
 */
tokensRouter.post(
  "/:id/token",
  zValidator("json", LiveKitTokenRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: "Validation failed",
          details: result.error.issues,
        },
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const { userId: bodyUserId, userName: bodyUserName } = c.req.valid("json");
    const candidateId = (await getCandidateId(c)) || bodyUserId;

    if (!candidateId) {
      throw new HTTPException(401, {
        message: "Unauthorized: Candidate identity required",
      });
    }

    const apiKey = c.env.LIVEKIT_API_KEY || process.env.LIVEKIT_API_KEY;
    const apiSecret = c.env.LIVEKIT_API_SECRET || process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new HTTPException(500, {
        message: "LiveKit credentials not configured in environment",
      });
    }

    const participantIdentity = candidateId;
    const participantName = bodyUserName || "Candidate";
    const roomName = id;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName,
      metadata: JSON.stringify({ interviewId: id, userId: candidateId }),
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    return c.json({
      token,
      room: roomName,
      identity: participantIdentity,
    });
  }
);
