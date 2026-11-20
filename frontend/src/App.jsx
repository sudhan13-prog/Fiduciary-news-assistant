import { useEffect, useRef, useState } from 'react';

const STAGES = [
  'Info Agent is reading the rulebook and understanding your question…',
  'Info Agent is searching the web for sources…',
  'Info Agent is drafting a response…',
  'Analysis Agent is verifying the response…',
];

export default function App() {
  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState([]); // { query, response?, sources?, error? }
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [conversationId, setConversationId] = useState(null);
  const [health, setHealth] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    if (!loading) return;
    setStage(0);
    const timers = [2500, 7000, 14000].map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  async function ask() {
    const q = query.trim();
    if (!q || loading) return;
    setQuery('');
    setLoading(true);
    setTurns((t) => [...t, { query: q }]);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setConversationId(data.conversationId);
      setTurns((t) => replaceLast(t, { query: q, response: data.response, sources: data.sources }));
    } catch (err) {
      setTurns((t) => replaceLast(t, { query: q, error: err.message || 'Something went wrong.' }));
    } finally {
      setLoading(false);
    }
  }

  function newConversation() {
    if (conversationId) {
      fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).catch(() => {});
    }
    setConversationId(null);
    setTurns([]);
  }

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1>Fiduciary News Assistant</h1>
          {turns.length > 0 && (
            <button className="link-btn" onClick={newConversation} disabled={loading}>
              New conversation
            </button>
          )}
        </header>

        {health?.mockMode && (
          <div className="banner">Demo mode: the backend has no API keys configured, so answers are placeholders.</div>
        )}
        {health && health.ok === false && <div className="banner error">Cannot reach the backend on port 8787.</div>}

        <main className="thread">
          {turns.map((t, i) => (
            <div key={i} className="turn">
              <div className="user-msg">{t.query}</div>
              {t.response && <ResponseCard response={t.response} sources={t.sources} />}
              {t.error && <div className="card error-card">{t.error}</div>}
            </div>
          ))}
          {loading && (
            <div className="card loading-card" role="status" aria-live="polite">
              <span className="spinner" />
              <span>{STAGES[stage]}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </main>

        <div className="composer">
          <label htmlFor="q">Ask about a news topic</label>
          <div className="input-wrap">
            <textarea
              id="q"
              value={query}
              placeholder="e.g. What is the latest on the UK interest rate decision?"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              rows={4}
            />
            <button className="ask-btn" onClick={ask} disabled={loading || !query.trim()}>
              Ask ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResponseCard({ response, sources = [] }) {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  return (
    <article className="card response-card">
      <h2>{response.title}</h2>
      <FormattedText text={response.answer} byId={byId} />
      {response.opinion && (
        <section className="opinion">
          <h3>AI's opinion</h3>
          <FormattedText text={response.opinion} byId={byId} />
        </section>
      )}
      {sources.length > 0 && (
        <section className="sources">
          <h3>Sources</h3>
          <ol>
            {sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  [{s.id}] {s.title} ↗
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

/** Renders paragraphs and "- " bullets, turning [n] citations into links. */
function FormattedText({ text, byId }) {
  const blocks = String(text || '').split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length && lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
      return (
        <ul key={bi}>
          {lines.map((l, li) => (
            <li key={li}>{withCitations(l.replace(/^\s*[-•*]\s+/, ''), byId)}</li>
          ))}
        </ul>
      );
    }
    return <p key={bi}>{withCitations(lines.join(' '), byId)}</p>;
  });
}

function withCitations(text, byId) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    const src = m && byId[Number(m[1])];
    return src ? (
      <a key={i} className="cite" href={src.url} target="_blank" rel="noopener noreferrer" title={src.title}>
        {part}
      </a>
    ) : (
      part
    );
  });
}

function replaceLast(arr, item) {
  return [...arr.slice(0, -1), item];
}
