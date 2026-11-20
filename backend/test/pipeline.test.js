// Runs the full two-agent pipeline in mock mode (no network / API keys needed).
process.env.MOCK_MODE = 'true';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { handleQuery } = await import('../src/orchestrator.js');
const { validateInfoResponse, createEnvelope, MessageType } = await import('../src/protocol.js');
const { stripRuleTalk } = await import('../src/agents/analysisAgent.js');
const { parseJSONLoose } = await import('../src/llm.js');

test('pipeline returns response, opinion and sources and keeps context', async () => {
  const r1 = await handleQuery({ query: 'UK interest rate decision' });
  assert.ok(r1.conversationId);
  assert.ok(r1.response.answer.length > 0);
  assert.ok(r1.response.opinion.length > 0);
  assert.ok(r1.sources.length > 0);
  assert.equal(r1.trace.analysisStatus, 'APPROVED');
  r1.sources.forEach((s) => assert.match(s.url, /^https?:\/\//));

  const r2 = await handleQuery({ conversationId: r1.conversationId, query: 'what happens next?' });
  assert.equal(r2.conversationId, r1.conversationId);
});

test('protocol rejects messages that drop the query or sources (R5)', () => {
  const bad = createEnvelope({
    type: MessageType.INFO_RESPONSE,
    from: 'info-agent',
    to: 'analysis-agent',
    conversationId: 'x',
    payload: { originalQuery: '', response: { answer: 'a' } },
  });
  assert.throws(() => validateInfoResponse(bad), /R5/);
});

test('rule/compliance talk is stripped from user-facing text, paragraphs kept', () => {
  const out = stripRuleTalk('Rates held at 4% [1]. This complies with R3.\n\nInflation fell [2].');
  assert.equal(out, 'Rates held at 4% [1].\n\nInflation fell [2].');
});

test('loose JSON parsing handles think blocks and fences', () => {
  assert.deepEqual(parseJSONLoose('<think>hmm</think>```json\n{"a":1}\n```'), { a: 1 });
});
