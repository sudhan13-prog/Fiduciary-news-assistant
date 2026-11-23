// Tests the three-engine search and source renumbering without calling any real API.
// All websites and results below are made-up placeholders (".example" addresses), except the
// social media addresses, which are needed to check that social media is removed.
process.env.TAVILY_API_KEY = 'test';
process.env.SERPER_API_KEY = 'test';
process.env.BRAVE_API_KEY = 'test';
process.env.MOCK_MODE = 'true';
// Fixed values so the tests do not depend on the settings in backend/.env.
process.env.RESULTS_PER_ENGINE = '3';
process.env.SEARCH_CANDIDATES = '20';
process.env.SEARCH_MAX_RESULTS = '10';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { multiSearch } = await import('../src/search.js');
const { renumberSources } = await import('../src/agents/analysisAgent.js');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(overrides = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(String(url));
    const u = String(url);
    for (const [key, fn] of Object.entries(overrides)) if (u.includes(key)) return fn();
    if (u.includes('api.tavily.com')) {
      return json({
        results: [
          { title: 'Story A', url: 'https://www.news-a.example/world/story-a/', content: 'Tavily text', published_date: '2026-11-04' },
          { title: 'Product page', url: 'https://www.shop.example/products/item', content: 'Product page' },
        ],
      });
    }
    if (u.includes('google.serper.dev')) {
      // Same article as Tavily's first result, written slightly differently (no "www.", no final "/").
      return json({ news: [{ title: 'Story A', link: 'https://news-a.example/world/story-a', snippet: 'Serper snippet', date: '1 day ago' }] });
    }
    if (u.includes('api.search.brave.com')) {
      assert.equal(opts.headers['X-Subscription-Token'], 'test');
      return json({
        results: [{ title: '<strong>Official</strong> statement', url: 'https://www.agency.example/statement', description: 'Official &amp; final', page_age: '2026-11-04' }],
      });
    }
    throw new Error(`unexpected url ${u}`);
  };
  return calls;
}

test('merges all engines and removes duplicate URLs', async () => {
  const calls = fakeFetch();
  const { results, stats } = await multiSearch(['query one', 'query two'], { topic: 'news', timeRange: 'week' });

  // Tavily, Serper and Brave get every query.
  assert.equal(calls.filter((c) => c.includes('tavily')).length, 2);
  assert.equal(calls.filter((c) => c.includes('serper')).length, 2);
  assert.equal(calls.filter((c) => c.includes('brave')).length, 2);

  const urls = results.map((r) => r.url);
  assert.equal(urls.filter((u) => u.includes('news-a.example/world/story-a')).length, 1, 'duplicate article merged');
  const storyA = results.find((r) => r.url.includes('news-a.example'));
  assert.deepEqual(storyA.foundBy.sort(), ['serper', 'tavily']);

  const statement = results.find((r) => r.url.includes('agency.example'));
  assert.equal(statement.title, 'Official statement', 'HTML tags stripped');
  assert.equal(statement.content, 'Official & final', 'entities decoded');
  assert.equal(stats, 'tavily=4 serper=2 brave=2');
});

test('social media results are removed and each engine\'s top results are kept in order', async () => {
  fakeFetch({
    'api.tavily.com': () =>
      json({
        results: [
          // Social media at the top: removed first, so the engine's 3 places go to real sources.
          { title: 'Post', url: 'https://www.facebook.com/somepage/posts/123', content: 'Social post' },
          { title: 'Tweet', url: 'https://x.com/someone/status/1', content: 'Tweet text' },
          { title: 'Video', url: 'https://m.youtube.com/watch?v=abc', content: 'Video' },
          { title: 'First real result', url: 'https://first.example/page', content: 'First real result' },
          { title: 'Second real result', url: 'https://second.example/page', content: 'Second real result' },
          { title: 'Third real result', url: 'https://third.example/page', content: 'Third real result' },
          { title: 'Fourth real result', url: 'https://fourth.example/page', content: 'Beyond the 3-result limit' },
        ],
      }),
  });
  const { results, stats } = await multiSearch(['query'], { topic: 'news' });
  const hosts = results.map((r) => new URL(r.url).hostname);
  assert.ok(!hosts.some((h) => /facebook|x\.com|youtube/.test(h)), 'no social media sources');
  assert.match(stats, /social_removed=3/);
  assert.ok(['first.example', 'second.example', 'third.example'].every((h) => hosts.includes(h)), 'top non-social results kept');
  assert.ok(!hosts.includes('fourth.example'), 'only the top 3 non-social results per engine are used');
});

test('live blogs whose URL words change are treated as one source', async () => {
  const { normalizeUrl } = await import('../src/search.js');
  // Same live page (same ID at the end), but the words in the address changed with the headline.
  const liveA = 'https://www.news-b.example/en/updates-first-headline/live-80015859';
  const liveB = 'https://www.news-b.example/en/updates-second-headline/live-80015859';
  assert.equal(normalizeUrl(liveA), normalizeUrl(liveB));
  // Different articles stay separate (with and without IDs).
  assert.notEqual(normalizeUrl('https://www.news-b.example/en/a/live-80015859'), normalizeUrl('https://www.news-b.example/en/a/live-80015860'));
  assert.notEqual(
    normalizeUrl('https://www.news-c.example/world/2026/nov/22/briefing-one'),
    normalizeUrl('https://www.news-c.example/world/2026/nov/23/briefing-two'),
  );
  assert.equal(
    normalizeUrl('https://www.news-d.example/news/short-title/article71734890.ece'),
    normalizeUrl('https://news-d.example/news/world/longer-title/article71734890.ece'),
  );

  fakeFetch({
    'api.tavily.com': () => json({ results: [{ title: 'Live page A', url: liveA, content: 'Short text' }] }),
    'google.serper.dev': () => json({ news: [{ title: 'Live page B', link: liveB, snippet: 'Longer text from the same page' }] }),
  });
  const { results } = await multiSearch(['query'], { topic: 'news' });
  assert.equal(results.filter((r) => r.url.includes('live-80015859')).length, 1);
});

test('analysis issue notes drop "thinking out loud" and stay short', async () => {
  const { tidyIssues } = await import('../src/agents/analysisAgent.js');
  const out = tidyIssues([
    {
      rule: 'R1/R2',
      description:
        "The figure is inconsistent with the source. Wait, let me re-read Source [5]. The title says nine but the body says 11. Let's look at the answer again. However, looking closely, it is ambiguous.",
    },
    { rule: 'R3', description: 'Claim presented as fact; attributed to the party making it.' },
    null,
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].description, 'The figure is inconsistent with the source. The title says nine but the body says 11.');
  assert.equal(out[1].description, 'Claim presented as fact; attributed to the party making it.');
});

test('Brave gets all 3 queries, spaced at least 1 second apart (free plan: 1 request per second)', async () => {
  const braveTimes = [];
  fakeFetch({
    'api.search.brave.com': () => {
      braveTimes.push(Date.now());
      return json({ results: [{ title: 'News', url: `https://www.news-e.example/story-${braveTimes.length}`, description: 'text' }] });
    },
  });
  await multiSearch(['q1', 'q2', 'q3'], { topic: 'news' });
  assert.equal(braveTimes.length, 3);
  assert.ok(braveTimes[1] - braveTimes[0] >= 1000 && braveTimes[2] - braveTimes[1] >= 1000, 'Brave calls are 1+ second apart');
});

test('keeps working when some engines fail', async () => {
  fakeFetch({ 'api.search.brave.com': () => json({ error: 'rate limited' }, 429), 'google.serper.dev': () => json({}, 500) });
  const { results, stats } = await multiSearch(['query'], { topic: 'news' });
  assert.ok(results.length >= 2, 'Tavily results still used');
  assert.match(stats, /brave=0\(HTTP 429\)/);
  assert.match(stats, /serper=0\(HTTP 500\)/);
});

test('fails clearly when every engine fails', async () => {
  fakeFetch({ tavily: () => json({}, 401), serper: () => json({}, 401), brave: () => json({}, 401) });
  await assert.rejects(multiSearch(['x'], {}), /No search results from any engine/);
});

test('gpt-oss style citations like 【2】 are converted, renumbered and match the source list', async () => {
  const { normalizeCitations } = await import('../src/citations.js');
  assert.equal(normalizeCitations('Event one 【2】 【7】 .'), 'Event one [2] [7].');
  assert.equal(normalizeCitations('Claim 【4†L1-L3】 and [3, 5].'), 'Claim [4] and [3][5].');
  assert.equal(normalizeCitations('Full-width ［6］.\n\n- Line [1]'), 'Full-width [6].\n\n- Line [1]');

  const sources = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, title: `S${id}`, url: `https://example.com/${id}` }));
  const out = renumberSources(
    { title: 'T', answer: '- Event one 【2】 【7】 .\n- Event two 【5】 .\n- Event three 【6】 .', opinion: 'View 【4】.' },
    sources,
  );
  assert.equal(out.response.answer, '- Event one [1] [2].\n- Event two [3].\n- Event three [4].');
  assert.equal(out.response.opinion, 'View [5].');
  assert.deepEqual(out.sources.map((s) => s.title), ['S2', 'S7', 'S5', 'S6', 'S4']);
});

test('sources are renumbered 1, 2, 3 in order of first citation', () => {
  const sources = [1, 2, 3, 4, 5, 6].map((id) => ({ id, title: `S${id}`, url: `https://example.com/${id}` }));
  const out = renumberSources(
    { title: 'T', answer: 'First claim [5]. Second [1][5].\n\n- Point [3]\n- Bad ref [9]', opinion: 'View [3].' },
    sources,
  );
  assert.equal(out.response.answer, 'First claim [1]. Second [2][1].\n\n- Point [3]\n- Bad ref ');
  assert.equal(out.response.opinion, 'View [3].');
  assert.deepEqual(out.sources.map((s) => [s.id, s.title]), [[1, 'S5'], [2, 'S1'], [3, 'S3']]);
});
