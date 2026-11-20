// Coordinates the two agents and keeps per-conversation context.
import { randomUUID } from 'node:crypto';
import { runInfoAgent } from './agents/infoAgent.js';
import { runAnalysisAgent } from './agents/analysisAgent.js';

const conversations = new Map(); // conversationId -> { history: [], updatedAt }
const MAX_TURNS = 10;
const TTL_MS = 6 * 60 * 60 * 1000;

export async function handleQuery({ conversationId, query }) {
  conversationId = conversations.has(conversationId) ? conversationId : randomUUID();
  const convo = conversations.get(conversationId) || { history: [] };
  const started = Date.now();

  // Agent 1 -> structured message -> Agent 2
  const infoEnvelope = await runInfoAgent({ conversationId, query, history: convo.history });
  const t1 = Date.now();
  const analysisEnvelope = await runAnalysisAgent(infoEnvelope);
  const t2 = Date.now();

  const { finalResponse, sources, status, issues } = analysisEnvelope.payload;

  convo.history.push({ query, title: finalResponse.title, answer: finalResponse.answer });
  convo.history = convo.history.slice(-MAX_TURNS);
  convo.updatedAt = Date.now();
  conversations.set(conversationId, convo);
  pruneOld();

  const trace = {
    infoMessageId: infoEnvelope.messageId,
    analysisMessageId: analysisEnvelope.messageId,
    searchQueries: infoEnvelope.payload.searchQueries,
    sourcesRetrieved: infoEnvelope.payload.sources.length,
    analysisStatus: status,
    issues,
    draftResponse: infoEnvelope.payload.response,
    timingsMs: { infoAgent: t1 - started, analysisAgent: t2 - t1 },
  };
  console.log(
    `[${new Date().toISOString()}] conv=${conversationId.slice(0, 8)} status=${status} sources=${sources.length} ` +
      `info=${trace.timingsMs.infoAgent}ms analysis=${trace.timingsMs.analysisAgent}ms` +
      (issues.length ? ` issues=${JSON.stringify(issues)}` : ''),
  );

  return { conversationId, response: finalResponse, sources, trace };
}

export function resetConversation(id) {
  conversations.delete(id);
}

function pruneOld() {
  const now = Date.now();
  for (const [id, c] of conversations) if (now - c.updatedAt > TTL_MS) conversations.delete(id);
}
