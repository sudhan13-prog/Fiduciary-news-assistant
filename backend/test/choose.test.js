// Tests the Info Agent's "choose sources" step with a fake search engine and a fake model (no real API calls).
// All websites are made-up placeholders.
process.env.MOCK_MODE = 'false';
process.env.TAVILY_API_KEY = 'test';
process.env.SERPER_API_KEY = '';
process.env.BRAVE_API_KEY = '';
process.env.LLM_API_KEY = 'test';
process.env.LLM_BASE_URL = 'https://llm.test/v1';
process.env.INFO_AGENT_BASE_URL = '';
process.env.INFO_AGENT_API_KEY = '';
process.env.RESULTS_PER_ENGINE = '15';
process.env.SEARCH_CANDIDATES = '20';
process.env.SEARCH_MAX_RESULTS = '10';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { runInfoAgent, pickChosen } = await import('../src/agents/infoAgent.js');

const OFFICIAL_URL = 'https://www.agency.example/official/statement';

// 15 search results: 14 ordinary pages, with the official page at position 14.
const searchResults = Array.from({ length: 15 }, (_, i) =>
  i === 13
    ? { title: 'Official statement: full text', url: OFFICIAL_URL, content: 'Full text of the official statement' }
    : { title: `Article ${i + 1}`, url: `https://news${i + 1}.example/story`, content: `Story ${i + 1}` },
);

function fakeApis({ chooseFails = false } = {}) {
  const seen = {};
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes('api.tavily.com')) return ok({ results: searchResults });

    // Fake model: answers depending on which step is asking.
    const prompt = JSON.parse(opts.body).messages.at(-1).content;
    const reply = (obj) => ok({ choices: [{ message: { content: JSON.stringify(obj) } }] });
    if (prompt.includes('plan the web search')) {
      return reply({ information_need: 'latest official decision', search_queries: ['official decision November 2026'], topic: 'news' });
    }
    if (prompt.includes('CANDIDATE SOURCES')) {
      seen.candidatesShown = (prompt.match(/^\[\d+\] /gm) || []).length;
      if (chooseFails) return new Response('server error', { status: 500 });
      const officialNumber = Number(prompt.match(/\[(\d+)\] Official statement/)[1]);
      return reply({ chosen: [officialNumber, 1, 2, 99, 1] }); // 99 is invalid, second 1 is a repeat
    }
    if (prompt.includes('RETRIEVED SOURCES')) {
      seen.writingSources = (prompt.match(/^\[\d+\] /gm) || []).length;
      return reply({ title: 'T', answer: 'The order was signed [1].', opinion: 'Op.', cited_source_ids: [1] });
    }
    throw new Error(`unexpected request ${u}`);
  };
  return seen;
}

test('Info Agent chooses the official source from 15 candidates and writes only from the chosen ones', async () => {
  const seen = fakeApis();
  const env = await runInfoAgent({ conversationId: 'c', query: 'latest official decision' });
  const p = env.payload;

  assert.equal(seen.candidatesShown, 15, 'all candidates shown when choosing');
  assert.equal(p.candidatesFound, 15);
  assert.deepEqual(
    p.sources.map((s) => [s.id, s.url]),
    [
      [1, OFFICIAL_URL],
      [2, 'https://news1.example/story'],
      [3, 'https://news2.example/story'],
    ],
    'chosen order kept, invalid and repeated numbers ignored, renumbered 1-3',
  );
  assert.equal(seen.writingSources, 3, 'answer written from the 3 chosen sources only');
});

test('if choosing fails, the top 10 candidates are used', async () => {
  const seen = fakeApis({ chooseFails: true });
  const env = await runInfoAgent({ conversationId: 'c', query: 'latest official decision' });
  assert.equal(env.payload.sources.length, 10);
  assert.equal(env.payload.sources[0].url, 'https://news1.example/story');
  assert.equal(seen.writingSources, 10);
});

test('chosen numbers: valid ones kept in order, limited to the maximum, fallback when none are valid', () => {
  const c = Array.from({ length: 20 }, (_, i) => ({ url: `u${i + 1}` }));
  assert.deepEqual(pickChosen(c, [5, '3', 5, 0, 21, 2.5, 7], 10).map((s) => s.url), ['u5', 'u3', 'u7']);
  assert.equal(pickChosen(c, Array.from({ length: 15 }, (_, i) => i + 1), 10).length, 10);
  assert.deepEqual(pickChosen(c, 'not a list', 10).map((s) => s.url), c.slice(0, 10).map((s) => s.url));
  assert.deepEqual(pickChosen(c, [], 10).length, 10);
});
