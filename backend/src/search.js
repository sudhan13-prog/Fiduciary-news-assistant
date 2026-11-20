// Tavily web search - retrieves titles, URLs and supporting content.
import { config } from './config.js';

const TAVILY_URL = 'https://api.tavily.com/search';

export async function tavilySearch(query, { topic = 'news', timeRange, maxResults = config.searchMaxResults } = {}) {
  const body = {
    query,
    topic: topic === 'general' ? 'general' : 'news',
    search_depth: 'advanced',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
  };
  if (timeRange && ['day', 'week', 'month', 'year'].includes(timeRange)) body.time_range = timeRange;

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.tavilyApiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    content: (r.content || '').slice(0, 1500),
    publishedDate: r.published_date || null,
    score: r.score ?? null,
  }));
}

/** Run several queries and merge results, de-duplicating by URL. */
export async function multiSearch(queries, opts) {
  const all = await Promise.allSettled(queries.map((q) => tavilySearch(q, opts)));
  const seen = new Map();
  for (const r of all) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      const key = item.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (!seen.has(key)) seen.set(key, item);
    }
  }
  if (!seen.size && all.every((r) => r.status === 'rejected')) throw all[0].reason;
  return [...seen.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, config.searchMaxResults);
}
