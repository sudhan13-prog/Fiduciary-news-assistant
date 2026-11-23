// Coordinates the two agents and keeps per-conversation context.
import { randomUUID } from 'node:crypto';
import { runInfoAgent } from './agents/infoAgent.js';
import { runAnalysisAgent } from './agents/analysisAgent.js';

const conversations = new Map(); // conversationId -> { history: [], updatedAt }
const MAX_TURNS = 10;
const TTL_MS = 6 * 60 * 60 * 1000;

// onStage(stage) reports progress to the UI: 'searching' -> 'drafting' -> 'evaluating' -> 'finalising'
export async function handleQuery({ conversationId, query, onStage = () => {} }) {
  conversationId = conversations.has(conversationId) ? conversationId : randomUUID();
  const convo = conversations.get(conversationId) || { history: [] };
  const started = Date.now();

  // Agent 1 -> structured message -> Agent 2
  const infoEnvelope = await runInfoAgent({ conversationId, query, history: convo.history, onStage });
  const t1 = Date.now();
  onStage('evaluating');
  const analysisEnvelope = await runAnalysisAgent(infoEnvelope);
  const t2 = Date.now();
  onStage('finalising');

  const { finalResponse, sources, status, issues, dateCheck } = analysisEnvelope.payload;

  convo.history.push({ query, title: finalResponse.title, answer: finalResponse.answer });
  convo.history = convo.history.slice(-MAX_TURNS);
  convo.updatedAt = Date.now();
  conversations.set(conversationId, convo);
  pruneOld();

  const trace = {
    infoMessageId: infoEnvelope.messageId,
    analysisMessageId: analysisEnvelope.messageId,
    searchQueries: infoEnvelope.payload.searchQueries,
    searchEngines: infoEnvelope.payload.searchStats,
    candidatesFound: infoEnvelope.payload.candidatesFound,
    sourcesChosen: infoEnvelope.payload.sources.length,
    analysisStatus: status,
    issues,
    dateCheck,
    draftResponse: infoEnvelope.payload.response,
    timingsMs: { infoAgent: t1 - started, analysisAgent: t2 - t1 },
  };

  return { conversationId, response: finalResponse, sources, trace };
}

export function resetConversation(id) {
  conversations.delete(id);
}

function pruneOld() {
  const now = Date.now();
  for (const [id, c] of conversations) if (now - c.updatedAt > TTL_MS) conversations.delete(id);
}
