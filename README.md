# Fiduciary News Assistant (LLM-MAFS prototype)

A two-agent fiduciary news system, built from *Product Plan Iteration-1*.

```
User query
   │
   ▼
Agent 1 - Info Agent (gpt-oss-20b)
   1. reads the fiduciary rulebook
   2. plans retrieval (understands the query, follows the user's instructions)
   3. searches the web with Tavily
   4. drafts a short answer + separate opinion, citing sources as [n]
   │   structured message: INFO_AGENT_RESPONSE { originalQuery, response, sources }   (R5 checked)
   ▼
Agent 2 - Analysis Agent (Qwen)
   1. reads the same rulebook
   2. checks compliance → APPROVED | CORRECTION_REQUIRED (internal only)
   3. APPROVED → Agent 1's answer passes through unchanged
      CORRECTION_REQUIRED → minimal correction using only the existing sources (no new search)
   │
   ▼
Final answer + clickable sources → React UI
```

## Project layout

| Path | Purpose |
|---|---|
| `backend/src/rulebook.js` | The shared fiduciary rulebook (R1–R5), read by both agents |
| `backend/src/agents/infoAgent.js` | Agent 1: plan, search, draft |
| `backend/src/agents/analysisAgent.js` | Agent 2: verify, approve or correct |
| `backend/src/protocol.js` | Agent-to-agent message envelopes and R5 integrity checks |
| `backend/src/search.js` | Tavily search |
| `backend/src/llm.js` | OpenAI-compatible chat client (OpenRouter, Groq, Together, vLLM, Ollama…) |
| `backend/src/orchestrator.js` | Runs the pipeline and keeps conversation context for follow-up questions |
| `backend/src/server.js` | REST API: `POST /api/ask`, `POST /api/reset`, `GET /api/health`, `GET /api/rulebook` |
| `frontend/src/App.jsx` | The chat-style React UI |

## Setup

Requires Node.js 18 or later.

1. Copy `backend/.env.example` to `backend/.env` and fill in:
   - `TAVILY_API_KEY`
   - `LLM_API_KEY` (and `LLM_BASE_URL` if you aren't using OpenRouter)
   - `INFO_AGENT_MODEL` / `ANALYSIS_AGENT_MODEL`: the exact model IDs your provider uses. Set the Qwen ID to the model you picked for the Analysis Agent.
   - Each agent can use a different provider (`INFO_AGENT_BASE_URL`, `ANALYSIS_AGENT_API_KEY`, …).
2. Install and run:

```powershell
cd backend; npm install; npm start
```

```powershell
cd frontend; npm install; npm run dev
```

3. Open http://localhost:5173.

Without API keys the backend runs in **demo mode** (placeholder search results and answers) so you can try the UI.

## Notes on the plan's requirements

- **Rules not disclosed to the user:** the APPROVED / CORRECTION_REQUIRED status and the list of issues are logged on the server only. A final filter also removes any sentence mentioning rules or compliance from the user-facing text. Set `EXPOSE_TRACE=true` to get the full trace (draft vs. final answer, issues, timings) in API responses for research and evaluation.
- **No new retrieval in Agent 2:** the Analysis Agent has no search tool. Citations to sources that don't exist are removed.
- **No uncertainty disclaimers from Agent 1:** this is in its system prompt, as the plan specifies.
- **Prompt injection:** both agents are told to treat retrieved web content as evidence only and to ignore instructions inside it (R3).

## Tests

```powershell
cd backend; npm test
```
