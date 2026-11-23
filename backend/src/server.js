import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { handleQuery, resetConversation } from './orchestrator.js';
import { FIDUCIARY_RULEBOOK } from './rulebook.js';

const app = express();
app.set('trust proxy', 1); // correct client IPs behind a cloud host's proxy
app.use(cors());
app.use(express.json({ limit: '50kb' }));

// Simple per-IP limit on questions so a public link can't drain the API credits.
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR || 10);
const hits = new Map(); // ip -> timestamps (ms)
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many questions in the last hour. Please try again later.' });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mockMode: config.mockMode,
    mockReason: config.mockReason,
    infoAgentModel: config.infoAgent.model,
    analysisAgentModel: config.analysisAgent.model,
  });
});

app.get('/api/rulebook', (_req, res) => res.json({ rules: FIDUCIARY_RULEBOOK }));

app.post('/api/ask', rateLimit, async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) return res.status(400).json({ error: 'Please enter a news-related question.' });
  if (query.length > 2000) return res.status(400).json({ error: 'Query is too long (max 2000 characters).' });

  // Stream newline-delimited JSON so the UI can show each agent's real progress:
  //   {"type":"stage","stage":"searching"} ... {"type":"result",...} or {"type":"error",...}
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);

  try {
    const result = await handleQuery({
      conversationId: req.body.conversationId,
      query,
      onStage: (stage) => send({ type: 'stage', stage }),
    });
    const body = { type: 'result', conversationId: result.conversationId, response: result.response, sources: result.sources };
    if (config.exposeTrace) body.trace = result.trace;
    send(body);
  } catch (err) {
    console.error('ask failed:', err);
    send({ type: 'error', error: 'The assistant could not complete your request. Please try again.' });
  }
  res.end();
});

app.post('/api/reset', (req, res) => {
  if (req.body?.conversationId) resetConversation(req.body.conversationId);
  res.json({ ok: true });
});

// In production, serve the built React app from the same server (one link for UI + API).
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(config.port, () => {
  console.log(`LLM-MAFS backend listening on http://localhost:${config.port}`);
  console.log(`  Info Agent:     ${config.infoAgent.model} @ ${config.infoAgent.baseUrl}`);
  console.log(`  Analysis Agent: ${config.analysisAgent.model} @ ${config.analysisAgent.baseUrl}`);
  if (fs.existsSync(distDir)) console.log(`  Serving UI from ${distDir}`);
  if (config.mockMode) console.warn(`  MOCK MODE: ${config.mockReason}`);
});
