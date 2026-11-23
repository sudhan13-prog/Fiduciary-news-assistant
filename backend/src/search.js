// Multi-engine web search: Tavily, Serper (Google), Brave run in parallel.
// Results are merged, duplicate URLs removed, and the best sources passed to the agents.
// Any engine without an API key (or that fails / times out) is skipped.

import { config } from './config.js';

const DAYS = { day: 1, week: 7, month: 31, year: 365 };

// Each engine returns [{ title, url, content, publishedDate }].
// allQueries=false would send only the first (main) query to an engine.
// minIntervalMs spaces an engine's queries out to respect its rate limit.
export const ENGINES = {
  tavily: {
    allQueries: true,
    async search(query, { topic, timeRange }) {
      const body = {
        query,
        topic: topic === 'general' ? 'general' : 'news',
        search_depth: 'advanced',
        max_results: config.resultsPerEngine,
        include_answer: false,
        include_raw_content: false,
      };
      if (DAYS[timeRange]) body.time_range = timeRange;
      const data = await getJSON('Tavily', 'https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.search.tavily}` },
        body: JSON.stringify(body),
      });
      return (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        publishedDate: r.published_date,
      }));
    },
  },

  serper: {
    allQueries: true,
    async search(query, { topic, timeRange }) {
      const news = topic !== 'general';
      const body = { q: query, num: config.resultsPerEngine };
      if (DAYS[timeRange]) body.tbs = `qdr:${timeRange[0]}`; // qdr:d / w / m / y
      const data = await getJSON('Serper', `https://google.serper.dev/${news ? 'news' : 'search'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': config.search.serper },
        body: JSON.stringify(body),
      });
      return ((news ? data.news : data.organic) || []).map((r) => ({
        title: r.title,
        url: r.link,
        content: r.snippet,
        publishedDate: r.date,
      }));
    },
  },

  brave: {
    allQueries: true,
    minIntervalMs: 1100, // free plan allows 1 request per second, so its queries run one after another
    async search(query, { topic, timeRange }) {
      const news = topic !== 'general';
      const params = new URLSearchParams({ q: query, count: String(config.resultsPerEngine) });
      const freshness = { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[timeRange];
      if (freshness) params.set('freshness', freshness);
      const data = await getJSON('Brave', `https://api.search.brave.com/res/v1/${news ? 'news' : 'web'}/search?${params}`, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': config.search.brave },
      });
      return ((news ? data.results : data.web?.results) || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: [r.description, ...(r.extra_snippets || [])].join(' '),
        publishedDate: r.page_age || r.age,
      }));
    },
  },
};

/**
 * Runs every configured engine in parallel, merges and ranks the results.
 * Returns { results: [{ title, url, content, publishedDate, foundBy }], stats: "tavily=10 serper=9 ..." }
 */
export async function multiSearch(queries, opts = {}) {
  const active = Object.keys(ENGINES).filter((name) => config.search[name]);
  if (!active.length) throw new Error('No search engine API keys configured');

  const tasks = [];
  for (const name of active) {
    const engine = ENGINES[name];
    const qs = engine.allQueries ? queries : queries.slice(0, 1);
    qs.forEach((q, i) => {
      // Rate-limited engines (Brave free plan) space their queries out; the others run all at once.
      const wait = engine.minIntervalMs ? i * engine.minIntervalMs : 0;
      const promise = wait ? sleep(wait).then(() => engine.search(q, opts)) : engine.search(q, opts);
      tasks.push({ name, promise });
    });
  }
  const settled = await Promise.allSettled(tasks.map((t) => t.promise));

  const counts = Object.fromEntries(active.map((n) => [n, { results: 0, error: null }]));
  const merged = new Map();
  let socialRemoved = 0;

  settled.forEach((outcome, i) => {
    const { name } = tasks[i];
    if (outcome.status === 'rejected') {
      counts[name].error = shortError(outcome.reason);
      return;
    }
    // Drop invalid links and social media first (never used as sources), then keep each engine's
    // top results only (some engines, e.g. Serper news, return more than asked).
    const valid = outcome.value.filter((item) => item?.url && /^https?:\/\//.test(item.url));
    const usable = valid.filter((item) => !isSocialMedia(item.url));
    socialRemoved += valid.length - usable.length;
    usable.slice(0, config.resultsPerEngine).forEach((item, rank) => {
      counts[name].results++;
      const key = normalizeUrl(item.url);
      const content = clean(item.content).slice(0, config.sourceMaxChars);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          title: clean(item.title) || item.url,
          url: item.url,
          content,
          publishedDate: item.publishedDate || null,
          engines: new Set([name]),
          bestRank: rank,
        });
      } else {
        existing.engines.add(name);
        existing.bestRank = Math.min(existing.bestRank, rank);
        if (content.length > existing.content.length) existing.content = content;
        existing.publishedDate ||= item.publishedDate || null;
      }
    });
  });

  const stats =
    Object.keys(counts).map((n) => `${n}=${counts[n].results}${counts[n].error ? `(${counts[n].error})` : ''}`).join(' ') +
    (socialRemoved ? ` social_removed=${socialRemoved}` : '');

  if (!merged.size) throw new Error(`No search results from any engine: ${stats}`);

  // Top candidates in the engines' own order (each engine's best results first).
  // Social media and duplicates were already removed above. The Info Agent then chooses
  // the sources it will use from these candidates, preferring primary and official sources.
  const results = [...merged.values()]
    .sort((a, b) => a.bestRank - b.bestRank)
    .slice(0, config.searchCandidates)
    .map(({ title, url, content, publishedDate, engines }) => ({ title, url, content, publishedDate, foundBy: [...engines] }));

  return { results, stats };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJSON(engine, url, options) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(config.searchTimeoutMs) });
  if (!res.ok) throw new Error(`${engine} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Social media, forums and video platforms: never used as sources.
const SOCIAL = [
  'facebook.com', 'fb.com', 'fb.watch', 'x.com', 'twitter.com', 'instagram.com', 'threads.net', 'tiktok.com',
  'youtube.com', 'youtu.be', 'reddit.com', 'linkedin.com', 'pinterest.com', 'quora.com', 't.me', 'telegram.me',
  'telegram.org', 'vk.com', 'ok.ru', 'snapchat.com', 'tumblr.com', 'discord.com', 'bsky.app', 'mastodon.social',
  'truthsocial.com', 'weibo.com', 'rumble.com', 'gab.com', 'twitch.tv', 'medium.com', 'substack.com',
];

export function isSocialMedia(url) {
  const host = hostOf(url);
  return !!host && SOCIAL.some((d) => host === d || host.endsWith(`.${d}`));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, '');
  } catch {
    return '';
  }
}

// Key used to spot duplicate pages. Many news sites end article URLs with a fixed ID
// (dw.com ".../live-80015859", nbcnews "...-rcna610822", thehindu ".../article71734890.ece").
// Live blogs change the words in the URL as the headline changes, but the ID stays the same,
// so pages on the same site with the same ID are treated as one source.
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    const path = u.pathname.replace(/\/$/, '');
    const last = path.split('/').pop() || '';
    const id = last.match(/(?:^|[-_])([a-z]{0,8}\d{6,})(?:\.[a-z]+)?$/i);
    return id ? `${host}#id:${id[1].toLowerCase()}` : `${host}${path}`;
  } catch {
    return url;
  }
}

function clean(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortError(err) {
  const msg = String(err?.message || err);
  if (/timeout|aborted/i.test(msg)) return 'timeout';
  const status = msg.match(/HTTP (\d{3})/);
  return status ? `HTTP ${status[1]}` : 'error';
}
