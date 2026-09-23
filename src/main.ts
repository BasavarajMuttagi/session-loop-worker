import {
    type JobContext,
    ServerOptions,
    cli,
    defineAgent,
    voice,
} from '@livekit/agents'
import * as deepgram from '@livekit/agents-plugin-deepgram'
import * as google from '@livekit/agents-plugin-google'
import * as inworld from '@livekit/agents-plugin-inworld'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()


export default defineAgent({
    entry: async (ctx: JobContext) => {
        // Initialize AgentSession with local turn detection and API integrations
        const session = new voice.AgentSession({
            turnHandling: {
                turnDetection: "vad"
            },
            stt: new deepgram.STT({
                model: 'nova-3',
                language: 'multi',
                apiKey: process.env.DEEPGRAM_API_KEY!,
                interimResults: true,
                smartFormat: true,

            }),
            llm: new google.LLM({
                model: 'gemini-flash-lite-latest', // Stable, active model endpoint
                apiKey: process.env.GOOGLE_API_KEY!,
                temperature: 0.7,
                maxOutputTokens: 1024,
            }),
            tts: new inworld.TTS({
                model: 'inworld-tts-1.5-max',
                voice: 'Ashley',
                apiKey: process.env.INWORLD_API_KEY!,
                temperature: 1.1,
                speakingRate: 1.0,
            }),
        })

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