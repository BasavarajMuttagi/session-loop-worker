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
dotenv.config({ path: ['.env', '.env.local'] })


export default defineAgent({
    entry: async (ctx: JobContext) => {
        // Initialize AgentSession with local turn detection and API integrations
        const session = new voice.AgentSession({
            turnHandling: {
                turnDetection: "vad"
            },
            // 1. Deepgram Flux STT (Real-time Speech-to-Text)
            stt: new deepgram.STTv2({
                model: 'flux-general-en',
                apiKey: process.env.DEEPGRAM_API_KEY!,
            }),
            // 2. Google Gemini Flash Lite for LLM 🧠
            llm: new google.LLM({
                model: 'gemini-flash-lite-latest',
                apiKey: process.env.GOOGLE_API_KEY!,
            }),
            // 3. Live Streaming TTS (Deepgram Aura-2)
            tts: new deepgram.TTS({
                model: 'aura-2-asteria-en',
                apiKey: process.env.DEEPGRAM_API_KEY!,
            }),
        });

        await ctx.connect()
        console.log(`Connected to room: ${ctx.room.name}`)

        // Started without the unauthorized aiCoustics noise cancellation block
        await session.start({
            room: ctx.room,
            agent: voice.Agent.create({
                instructions: 'You are a helpful, warm voice assistant. Keep your responses concise and conversational.',
            }),
        })

        await session.generateReply({
            instructions: 'Greet the user warmly and offer your assistance.',
        })
    },
})

cli.runApp(
    new ServerOptions({
        agent: fileURLToPath(import.meta.url),
        agentName: 'my-agent',
        wsURL: process.env.LIVEKIT_URL,
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
    })
)