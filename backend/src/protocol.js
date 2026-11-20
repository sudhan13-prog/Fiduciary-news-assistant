// Structured agent-to-agent messaging protocol.
// Every message between agents is an envelope with a type, sender, receiver and payload.
// Rule R5 (Communication Integrity) is enforced here: the original query, response
// and source references are carried verbatim and validated at each hop.

import { randomUUID } from 'node:crypto';

export const MessageType = Object.freeze({
  INFO_RESPONSE: 'INFO_AGENT_RESPONSE', // Agent 1 -> Agent 2
  ANALYSIS_RESULT: 'ANALYSIS_AGENT_RESULT', // Agent 2 -> Orchestrator
});

export const AnalysisStatus = Object.freeze({
  APPROVED: 'APPROVED',
  CORRECTION_REQUIRED: 'CORRECTION_REQUIRED',
});

export function createEnvelope({ type, from, to, conversationId, payload }) {
  return Object.freeze({
    protocol: 'llm-mafs/1.0',
    messageId: randomUUID(),
    type,
    from,
    to,
    conversationId,
    timestamp: new Date().toISOString(),
    payload: deepFreeze(structuredClone(payload)),
  });
}

/** Validates the Agent 1 -> Agent 2 message. Throws if integrity is broken. */
export function validateInfoResponse(envelope) {
  const p = envelope?.payload;
  const problems = [];
  if (envelope?.type !== MessageType.INFO_RESPONSE) problems.push('wrong message type');
  if (!p || typeof p.originalQuery !== 'string' || !p.originalQuery.trim()) problems.push('missing originalQuery');
  if (!p?.response || typeof p.response.answer !== 'string') problems.push('missing response.answer');
  if (!Array.isArray(p?.sources)) problems.push('missing sources array');
  else
    p.sources.forEach((s, i) => {
      if (!s || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) problems.push(`source[${i}] has invalid url`);
    });
  if (problems.length) throw new Error(`Protocol integrity violation (R5): ${problems.join('; ')}`);
  return true;
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}
