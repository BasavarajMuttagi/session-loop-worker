import {
    type JobContext,
    ServerOptions,
    cli,
    defineAgent,
    voice,
} from '@livekit/agents'
import * as deepgram from '@livekit/agents-plugin-deepgram'
import * as google from '@livekit/agents-plugin-google'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { SessionLoopClient, createInterviewAgent } from './agent'
import type { PromptResponse } from './types'

dotenv.config({ path: ['.env', '.env.local'] })

const loopClient = new SessionLoopClient(process.env.WORKER_API_URL || "http://127.0.0.1:8787")

export default defineAgent({
    entry: async (ctx: JobContext) => {
        const session = new voice.AgentSession({
            turnHandling: {
                turnDetection: "vad",
                endpointing: {
                    mode: "dynamic",
                    minDelay: 2000,
                    maxDelay: 5000,
                },
            },
            stt: new deepgram.STTv2({
                model: 'flux-general-en',
                apiKey: process.env.DEEPGRAM_API_KEY!,
            }),
            llm: new google.LLM({
                model: 'gemini-flash-lite-latest',
                apiKey: process.env.GOOGLE_API_KEY!,
            }),
            tts: new deepgram.TTS({
                model: 'aura-2-asteria-en',
                apiKey: process.env.DEEPGRAM_API_KEY!,
            }),
        });

        await ctx.connect()
        console.log(`Connected to room: ${ctx.room.name}`)

        const interviewId = ctx.room.name
        if (!interviewId) {
            console.error("Room name is empty")
            return
        }

        // 1. Fetch the interview template & current prompt from the Durable Object
        const data = await loopClient.getInterview(interviewId)
        const interview = data?.liveState?.interview || data?.record?.sessionData

        if (!interview) {
            console.error(`Interview session ${interviewId} not found`)
            return
        }

        const promptRes = await loopClient.getCurrentPrompt(interviewId)

        let isCompleting = false
        let completionNotified = false

        const notifyCompletion = async () => {
            if (completionNotified) return
            completionNotified = true
            console.log(`[Interview ${interviewId}] Audio closing remarks finished. Broadcasting session_completed to room.`)
            try {
                const payload = new TextEncoder().encode(JSON.stringify({ type: "session_completed" }))
                if (ctx.room.localParticipant) {
                    await ctx.room.localParticipant.publishData(payload, { reliable: true })
                }
            } catch (err) {
                console.error("Failed to publish session_completed data:", err)
            }
        }

        let turnSeq = 0;
        let lastBroadcastText = "";
        let lastBroadcastTime = 0;

        // 2. Start agent with strict structured prompt, state machine tools, and state broadcast
        const agent = createInterviewAgent(
            loopClient,
            interviewId,
            interview,
            promptRes.text,
            async (closingText: string) => {
                console.log(`[Interview ${interviewId}] State machine finished. Closing remarks: "${closingText}"`)
                isCompleting = true
                // Safety timer: ensure session concludes even if agent state event is delayed
                setTimeout(() => {
                    notifyCompletion()
                }, 25000)
            },
            async (updatedPrompt: PromptResponse) => {
                console.log(`[Interview ${interviewId}] State transitioned:`, updatedPrompt.cursor, updatedPrompt.type);
                try {
                    const stateMsg = {
                        type: "state_update",
                        cursor: updatedPrompt.cursor,
                        status: updatedPrompt.interviewStatus,
                        activePrompt: updatedPrompt.text,
                        isComplete: updatedPrompt.isComplete,
                        totalQuestions: interview.questions.length,
                        revision: Date.now(),
                    };
                    const payload = new TextEncoder().encode(JSON.stringify(stateMsg));
                    if (ctx.room.localParticipant) {
                        await ctx.room.localParticipant.publishData(payload, { reliable: true });
                    }
                } catch (err) {
                    console.error("Failed to broadcast state update:", err);
                }
            }
        )

        // Listen for direct UI action voice triggers (Repeat, Clarify, Skip, Text Answer)
        ctx.room.on('dataReceived', async (payload: Uint8Array) => {
            try {
                const text = new TextDecoder().decode(payload)
                const data = JSON.parse(text)
                if (data.type === "agent_say" && data.text) {
                    console.log(`[Interview ${interviewId}] Speaking prompt from UI trigger: "${data.text.slice(0, 60)}..."`)
                    const speech = session.say(data.text, { allowInterruptions: false })
                    if (data.isClosing) {
                        isCompleting = true
                        await speech.waitForPlayout()
                        setTimeout(() => {
                            notifyCompletion()
                        }, 1200)
                    }
                }
            } catch (err) {
                console.error("Failed to process room data packet:", err)
            }
        })

        // Track when agent finishes speaking closing remarks in voice conversation
        session.on(voice.AgentSessionEventTypes.AgentStateChanged, async (ev) => {
            if (isCompleting && ev.oldState === "speaking" && ev.newState !== "speaking") {
                console.log(`[Interview ${interviewId}] Agent finished speaking closing remarks. Broadcasting completion in 1.2s...`)
                setTimeout(() => {
                    notifyCompletion()
                }, 1200)
            }
        })

        // Broadcast conversation items (including clarifications, side questions, natural chit-chat)
        session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (ev) => {
            try {
                const item = ev.item as any;
                if (!item || (item.role !== "assistant" && item.role !== "user")) return;
                
                let text = "";
                if (typeof item.content === "string") {
                    text = item.content;
                } else if (Array.isArray(item.content)) {
                    text = item.content.map((c: any) => typeof c === "string" ? c : c.text || "").join("");
                } else if (item.text) {
                    text = item.text;
                }

                const cleanText = text ? text.trim() : "";
                const now = Date.now();

                // Prevent immediate duplicate broadcast of identical text within 1s
                if (cleanText && (cleanText !== lastBroadcastText || now - lastBroadcastTime > 1000)) {
                    lastBroadcastText = cleanText;
                    lastBroadcastTime = now;
                    turnSeq += 1;

                    console.log(`[Interview ${interviewId}] Conversation turn #${turnSeq} (${item.role}): "${cleanText.slice(0, 60)}..."`);
                    const payload = new TextEncoder().encode(JSON.stringify({
                        type: "chat_turn",
                        id: `turn-${turnSeq}-${now}`,
                        sequence: turnSeq,
                        timestamp: now,
                        from: item.role,
                        text: cleanText,
                    }));
                    if (ctx.room.localParticipant) {
                        await ctx.room.localParticipant.publishData(payload, { reliable: true });
                    }
                }
            } catch (err) {
                console.error("Failed to broadcast conversation item:", err);
            }
        });

        // Log and broadcast candidate speech transcripts for live UI transcribing
        session.on(voice.AgentSessionEventTypes.UserInputTranscribed, async (ev) => {
            if (ev.transcript) {
                console.log(`[Interview ${interviewId}] Candidate speaking: "${ev.transcript}" (final: ${ev.isFinal})`);
                try {
                    const payload = new TextEncoder().encode(JSON.stringify({
                        type: "live_transcript",
                        transcript: ev.transcript,
                        isFinal: ev.isFinal,
                    }));
                    if (ctx.room.localParticipant) {
                        await ctx.room.localParticipant.publishData(payload, { reliable: true });
                    }
                } catch (e) {
                    console.error("Failed to broadcast live transcript:", e);
                }
            }
        })

        await session.start({
            room: ctx.room,
            agent,
        })

        // 3. Greet candidate and ask initial active question
        await session.generateReply({
            instructions: `Greet the candidate warmly with: "${interview.opening}". Then ask: "${promptRes.text}".`,
        })
    },
})

cli.runApp(
    new ServerOptions({
        agent: fileURLToPath(import.meta.url),
        wsURL: process.env.LIVEKIT_URL,
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
    })
)
