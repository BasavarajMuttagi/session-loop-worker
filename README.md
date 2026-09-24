# Session Loop — Real-Time AI Technical Interview Platform

Session Loop is a full-stack, real-time AI voice technical interview simulation platform. It synthesizes structured, deep technical interview tracks from syllabus topics or documentation URLs and conducts interactive, spoken voice interviews with targeted follow-ups, strict question masking, and instant state synchronization.

---

## Architecture Overview

```
                          ┌───────────────────────────┐
                          │   Candidate Frontend UI   │
                          │   (React 19 + Tailwind v4)│
                          └───────┬───────────▲───────┘
                                  │           │
                WebRTC Audio Stream &         │ Real-time Data Packets
                Optimistic Chat State         │ (state_update, chat_turn)
                                  ▼           │
                          ┌───────────────────┴───────┐
                          │      LiveKit Server       │
                          └───────▲───────────▲───────┘
                                  │           │
                     Audio STT/TTS│           │ Agent Dialogue & Tools
                                  ▼           │
                          ┌───────────────────┴───────┐
                          │    LiveKit Voice Agent    │
                          │ (Deepgram + Gemini Flash) │
                          └─────────────┬─────────────┘
                                        │ HTTP REST / Internal RPC
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Cloudflare Worker Backend                             │
│                                                                             │
│  ┌─────────────────────────┐   Single-Writer   ┌──────────────────────────┐ │
│  │    Hono API Layer       │ ────────────────► │  InterviewSessionDO      │ │
│  │ (Validation & Auth)     │   State Machine   │  (Durable Object Engine) │ │
│  └────────────┬────────────┘                   └─────────────┬────────────┘ │
│               │                                              │              │
│               │ D1 Database (SQLite + Drizzle ORM)           │ Sync State   │
│               ▼                                              ▼              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           interview_attempts                           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Capabilities

1. **AI Question Synthesis ([`src/generator.ts`](./src/generator.ts))**
   - Automatically crawls and extracts key concepts from documentation links and topics using Google Gemini & Vercel AI SDK.
   - Formulates clean, spoken technical prompts with rubrics, clarification hints, recommended timers, and deep-dive follow-up questions.

2. **Pure Single-Writer State Machine ([`src/durable-objects/InterviewSessionDO.ts`](./src/durable-objects/InterviewSessionDO.ts))**
   - Strictly controls 1-by-1 progression: `Main Question` $\rightarrow$ `Follow-up(s)` $\rightarrow$ `Next Question`.
   - **Privacy & Anti-Leak Masking**: Future unasked questions and follow-ups are never exposed over the API until reached by the candidate.
   - **Verbatim Transcripts**: Candidate's exact spoken words on skips and answers are recorded in full.
   - **Idempotency Guard**: Rejects duplicate submission IDs to prevent race conditions or double state advancement.
   - **Session Alarms**: Automatically triggers total interview session timeout alarms.

3. **Real-time Event Protocol & Optimistic Updates**
   - Broadcasts typed `state_update`, `chat_turn`, and `live_transcript` packets over LiveKit WebRTC Data Channels.
   - Implements immediate optimistic commit of candidate speech turns on `isFinal: true` transcripts, eliminating UI disappearance gaps or layout jumps.

4. **Iterative Retries & Attempt History**
   - Deep-clones prior sessions into fresh attempts (`Attempt #1`, `Attempt #2`, `Attempt #3`) while preserving attempt group lineage in D1 SQLite.

---

## Tech Stack

- **Backend Server**: Cloudflare Workers, Hono, `@hono/zod-validator`, Zod
- **State Machine**: Cloudflare Durable Objects
- **Database**: Cloudflare D1 (SQLite) with Drizzle ORM
- **Voice Agent**: `@livekit/agents`, Deepgram STT (`flux-general-en`), Deepgram TTS (`aura-2-asteria-en`), Google Gemini (`gemini-flash-lite-latest`)
- **Authentication**: Clerk (`@clerk/hono` and `@clerk/react`)
- **Testing**: Vitest with in-memory Hono `app.request()` execution

---

## Directory Structure

```
├── session-loop-worker/             # Cloudflare Worker Backend & LiveKit Agent
│   ├── src/
│   │   ├── durable-objects/         # Pure Single-Writer State Machine
│   │   │   └── InterviewSessionDO.ts
│   │   ├── routes/                  # Modular Hono API Controllers
│   │   │   ├── interviews.ts        # /generate, /, /:id, /:id/retry
│   │   │   ├── session.ts           # /answer, /skip, /clarify, /repeat, /end
│   │   │   └── tokens.ts            # /token (LiveKit JWT generation)
│   │   ├── services/                # Business Logic (masking, cloning, sync)
│   │   │   └── interviewService.ts
│   │   ├── db/                      # Drizzle Schema & D1 Connection
│   │   ├── middlewares/             # Auth & Centralized Error Handlers
│   │   ├── generator.ts             # AI Interview Generator (Gemini)
│   │   ├── agent.ts                 # LiveKit Agent Tools & Session Client
│   │   ├── main.ts                  # LiveKit Agent Entrypoint
│   │   ├── types.ts                 # Zod Schemas & Domain Types
│   │   └── index.ts                 # Worker Entrypoint & Route Mounting
│   └── tests/                       # Unit & In-Memory Hono Integration Tests
│
└── session-loop-ui/                 # Frontend SPA
    ├── src/
    │   ├── components/
    │   │   ├── interview/           # VoiceRoom, InterviewChat, ProgressRing
    │   │   ├── agents-ui/           # AgentAudioVisualizerGrid Dot Matrix
    │   │   └── ui/                  # Shadcn Component Primitives
    │   ├── hooks/                   # useInterviewSession State Management Hook
    │   ├── lib/                     # api.ts (Zod Validated Client), interviewUtils.ts
    │   ├── pages/                   # Room, Dashboard, Create, Report, Home
    │   └── types/                   # Frontend Domain Types & Discriminated Unions
    └── tests/                       # UI Logic & Type Validation Tests
```

---

## Environment Variables

### Backend Worker & Agent (`session-loop-worker/.env` and `wrangler.jsonc`)
```env
GOOGLE_API_KEY="your-gemini-api-key"
LIVEKIT_URL="wss://your-livekit-server.livekit.cloud"
LIVEKIT_API_KEY="your-livekit-api-key"
LIVEKIT_API_SECRET="your-livekit-api-secret"
DEEPGRAM_API_KEY="your-deepgram-api-key"
CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
INTERNAL_SECRET="session-loop-secret"
WORKER_API_URL="http://127.0.0.1:8787"
```

### Frontend UI (`session-loop-ui/.env`)
```env
VITE_CLERK_PUBLISHABLE_KEY="pk_test_..."
VITE_WORKER_API_URL="http://127.0.0.1:8787"
VITE_LIVEKIT_URL="wss://your-livekit-server.livekit.cloud"
```

---

## Getting Started

### 1. Backend Worker Setup

```bash
cd session-loop-worker
npm install

# Apply local D1 database migrations
npx wrangler d1 migrations apply DB --local

# Start the Cloudflare Worker dev server (Port 8787)
npm run dev

# In a separate terminal, start the LiveKit Voice Agent
npm run agent:dev
```

### 2. Frontend UI Setup

```bash
cd ../session-loop-ui
npm install

# Start the Vite development server (Port 5173)
npm run dev
```

---

## Testing & Quality Assurance

### Run Worker Test Suite (23 Tests)
```bash
cd session-loop-worker
npm test
```
- Tests single-writer state transitions, follow-up gating, idempotency, alarm timeouts, and route validation.

### Run Frontend Test Suite (8 Tests)
```bash
cd session-loop-ui
npm test
```
- Tests Zod domain parsing, optimistic message transitions, question masking, and turn deduplication.

### Production Build
```bash
cd session-loop-ui
npm run build
```

---

## License

MIT
