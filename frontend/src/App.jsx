import { useEffect, useRef, useState } from 'react';

// Progress messages, driven by the real stage the backend reports.
const STAGES = {
  searching: 'Info Agent is searching the web…',
  drafting: 'Info Agent is writing a detailed response…',
  evaluating: 'Analysis Agent is evaluating the response…',
  finalising: 'Your answer is on the way…',
};

export default function App() {
  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState([]); // { query, response?, sources?, error? }
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('searching');
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

  async function ask() {
    const q = query.trim();
    if (!q || loading) return;
    setQuery('');
    setStage('searching');
    setLoading(true);
    setTurns((t) => [...t, { query: q }]);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, conversationId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const data = await readStream(res, setStage);
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
              <span>{STAGES[stage] || STAGES.searching}</span>
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
          <h3>My Opinion</h3>
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

const BULLET = /^\s*[-•*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,6}\s+/;

/** Renders "### " headings, paragraphs, "- " / "1." lists and **bold**, turning [n] citations into links. */
function FormattedText({ text, byId }) {
  const out = [];
  let para = [];
  let list = null; // { ordered, items }

  const flushPara = () => {
    if (para.length) out.push(<p key={out.length}>{inline(para.join(' '), byId)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul';
      out.push(
        <Tag key={out.length} className="answer-list">
          {list.items.map((item, i) => (
            <li key={i}>{inline(item, byId)}</li>
          ))}
        </Tag>,
      );
    }
    list = null;
  };

  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
    } else if (HEADING.test(line)) {
      flushPara();
      flushList();
      out.push(<h4 key={out.length}>{inline(line.replace(HEADING, '').replace(/\*\*/g, ''), byId)}</h4>);
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      flushPara();
      const ordered = NUMBERED.test(line);
      if (list && list.ordered !== ordered) flushList();
      list ||= { ordered, items: [] };
      list.items.push(line.replace(ordered ? NUMBERED : BULLET, ''));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

/** Handles **bold** and [n] citation links inside a line. */
function inline(text, byId) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, ci) =>
    /^\*\*[^*]+\*\*$/.test(chunk) ? (
      <strong key={ci}>{withCitations(chunk.slice(2, -2), byId)}</strong>
    ) : (
      <span key={ci}>{withCitations(chunk, byId)}</span>
    ),
  );
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

/** Reads the backend's newline-delimited JSON stream: stage updates, then the result (or an error). */
async function readStream(res, onStage) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  const handle = (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.type === 'stage') onStage(msg.stage);
    else if (msg.type === 'error') throw new Error(msg.error);
    else if (msg.type === 'result') result = msg;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(handle);
  }
  handle(buffer);
  if (!result) throw new Error('The connection closed before the answer arrived. Please try again.');
  return result;
}

function replaceLast(arr, item) {
  return [...arr.slice(0, -1), item];
}
