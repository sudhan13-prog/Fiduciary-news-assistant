# Fiduciary News Assistant (LLM-MAFS prototype)

An interactive multi-agent fiduciary system for news questions. Two LLM agents share one **fiduciary rulebook**: the **Info Agent** retrieves news and drafts an answer, and the **Analysis Agent** checks the draft against the rulebook and corrects it before the user sees it.

```
User query
   │
   ▼
Agent 1 - Info Agent (gpt-oss-120b on Groq)
   1. reads the fiduciary rulebook
   2. understands the query and plans the search (prefers official sources and established news outlets)
   3. searches the web with Tavily, Serper (Google) and Brave in parallel,
      merges the results and removes duplicate URLs
   4. drafts a detailed answer + a separate opinion, citing sources as [n]
   │   structured message: INFO_AGENT_RESPONSE { originalQuery, response, sources }   (R5 integrity check)
   ▼
Agent 2 - Analysis Agent (qwen3.8-27b on Groq)
   1. reads the same rulebook
   2. checks compliance → APPROVED | CORRECTION_REQUIRED (internal only, logged on the server)
   3. APPROVED → the Info Agent's answer passes through unchanged
      CORRECTION_REQUIRED → minimal correction using only the existing sources (no new search)
   │
   ▼
Final answer + "My Opinion" + sources numbered 1, 2, 3… → React UI
(the UI shows each agent's live progress while it works)
```

## Fiduciary rulebook

| ID | Rule | Behaviour |
|---|---|---|
| R1 | User Interest Priority | Prioritise the user's interests when retrieving, analysing and presenting information. |
| R2 | User Goal Alignment | Understand the user's query and generate responses that align with the user's information requirements and serve the user's information needs. |
| R3 | No Conflicting Interests | Do not favour third-party interests and do not allow these interests to influence the selection, interpretation or presentation of information. |
| R4 | Instruction Adherence | Follow the user's instructions when generating responses. |
| R5 | Communication Integrity | Information exchanged between agents must preserve the original user query, generated response and relevant source references. |

The rulebook is defined once in `backend/src/rulebook.js` and is read by both agents.

## Tech stack

| Component | Technology |
|---|---|
| Frontend | React (Vite) |
| Backend | Node.js (Express), REST API (JSON) |
| Info Agent | `openai/gpt-oss-120b` via Groq |
| Analysis Agent | `qwen/qwen3.8-27b` via Groq |
| Web search | Tavily, Serper (Google) and Brave Search APIs, in parallel |

## Project layout

| Path | Purpose |
|---|---|
| `backend/src/rulebook.js` | Shared fiduciary rulebook (R1–R5) |
| `backend/src/agents/infoAgent.js` | Agent 1: plan, search, draft |
| `backend/src/agents/analysisAgent.js` | Agent 2: verify, approve or correct |
| `backend/src/protocol.js` | Agent-to-agent message envelopes and R5 integrity checks |
| `backend/src/search.js` | Four-engine search: parallel calls, timeouts, duplicate removal, ranking |
| `backend/src/llm.js` | OpenAI-compatible chat client (Groq, OpenRouter, Together, vLLM, Ollama…) |
| `backend/src/orchestrator.js` | Runs the pipeline and keeps conversation context for follow-up questions |
| `backend/src/server.js` | REST API, per-IP rate limit, and serves the built UI in production |
| `frontend/src/App.jsx` | Chat-style React UI |

API endpoints: `POST /api/ask`, `POST /api/reset`, `GET /api/health`, `GET /api/rulebook`.

## Run locally

Requires Node.js 18 or later. On Windows PowerShell, use `npm.cmd` if `npm` is blocked.

1. Copy `backend/.env.example` to `backend/.env` and fill in:

   ```ini
   TAVILY_API_KEY=your-tavily-key
   SERPER_API_KEY=your-serper-key
   BRAVE_API_KEY=your-brave-key
   LLM_BASE_URL=https://api.groq.com/openai/v1
   LLM_API_KEY=your-groq-key
   INFO_AGENT_MODEL=openai/gpt-oss-120b
   ANALYSIS_AGENT_MODEL=qwen/qwen3.8-27b
   ```

   Never commit `.env`; it is listed in `.gitignore`.

2. Install everything once (from the project's top folder):

   ```bash
   npm run install:all
   ```

3. Start the backend and frontend together in one terminal:

   ```bash
   npm start
   ```

4. Open http://localhost:5173.

Without API keys the backend runs in **demo mode** (placeholder search results and answers), so you can still try the UI.

### Production build (one server for UI + API)

```bash
npm run build
npm --prefix backend start
```

Then open http://localhost:8787.

## Deploy on Render

1. Push this repository to GitHub.
2. On https://render.com create a **Web Service** from the repository:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm --prefix backend start`
3. Add environment variables: `TAVILY_API_KEY`, `SERPER_API_KEY`, `BRAVE_API_KEY`, `LLM_BASE_URL`, `LLM_API_KEY`, `INFO_AGENT_MODEL`, `ANALYSIS_AGENT_MODEL`, and `NODE_VERSION=22`. Don't set `PORT`; Render provides it.

On the free plan the service sleeps after about 15 minutes without visitors, so the first request afterwards can take up to a minute.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_PER_HOUR` | `10` | Questions allowed per visitor IP per hour |
| `SEARCH_CANDIDATES` | `20` | Search results (after removing social media and duplicates) the Info Agent chooses from |
| `SEARCH_MAX_RESULTS` | `10` | Sources the Info Agent chooses (primary and official first) and uses for the answer |
| `RESULTS_PER_ENGINE` | `5` | Results requested from each engine per search query |
| `SOURCE_MAX_CHARS` | `1200` | Characters of text kept per source |
| `SEARCH_TIMEOUT_MS` | `10000` | An engine slower than this is skipped for that question |
| `EXPOSE_TRACE` | `false` | `true` adds the internal trace (Info Agent draft, APPROVED / CORRECTION_REQUIRED, issues, timings) to API responses. Keep `false` for real users. |
| `MOCK_MODE` | `false` | `true` forces demo mode |
| `INFO_AGENT_BASE_URL`, `INFO_AGENT_API_KEY`, `ANALYSIS_AGENT_BASE_URL`, `ANALYSIS_AGENT_API_KEY` | (shared values) | Optional per-agent provider settings |

## How the search works

- Every engine with a key in `.env` runs in parallel; an engine without a key is skipped.
- Tavily, Serper and Brave each get all of the Info Agent's search queries (up to 3). Brave's free plan allows about 1 request per second, so its queries run about 1 second apart.
- Social media results are removed, and results are merged with duplicate URLs removed. The top `SEARCH_CANDIDATES` (20), in the engines' own order, go to the Info Agent.
- The Info Agent chooses up to `SEARCH_MAX_RESULTS` (10) of them that best answer the question, prioritising primary sources and official websites and ignoring social media and individual blogs or posts, most important first. It writes the answer only from the chosen sources, and the Analysis Agent checks against the same sources. If choosing fails, the top 10 candidates are used.
- An engine that fails or takes longer than `SEARCH_TIMEOUT_MS` is skipped, and the answer uses the others.

## Tests

```bash
cd backend
npm test
```
