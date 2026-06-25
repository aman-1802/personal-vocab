import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { Router, json, urlencoded } from 'express';
import crypto from 'crypto';
import { db } from './db.js';

export const mcpRouter = Router();

const BASE_URL = 'https://vocab.aman-n8n.site/mcp';

// ── In-memory OAuth state (survives process restarts poorly, but fine for personal use) ──
const oauthClients = {};  // clientId → clientMetadata
const authCodes = {};     // code → { clientId, codeChallenge, expiresAt }

// ── OAuth: metadata discovery (public — no auth) ──────────────────────────────
mcpRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  });
});

// ── OAuth: dynamic client registration (public) ───────────────────────────────
mcpRouter.post('/oauth/register', json(), (req, res) => {
  const clientId = crypto.randomUUID();
  oauthClients[clientId] = req.body;
  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
    ...req.body,
  });
});

// ── OAuth: authorization page (public) ────────────────────────────────────────
mcpRouter.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, state, code_challenge } = req.query;
  if (!redirect_uri) return res.status(400).send('Missing redirect_uri');

  // Store params in a short-lived session token so the user's click is secure
  const sessionToken = crypto.randomBytes(16).toString('hex');
  authCodes[`_pending_${sessionToken}`] = {
    clientId: client_id,
    redirectUri: redirect_uri,
    state: state || '',
    codeChallenge: code_challenge || '',
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
  };

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vocab — Authorize Claude</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f5f0e4; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; }
    .card { background: white; border-radius: 1.25rem; padding: 2.5rem 2rem;
            max-width: 380px; width: 90%; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,.1); }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.4rem; margin-bottom: .5rem; color: #1a1a1a; }
    p { color: #555; line-height: 1.5; margin-bottom: 1.5rem; font-size: .95rem; }
    .perms { background: #f9f7f2; border-radius: .75rem; padding: 1rem;
             text-align: left; margin-bottom: 1.5rem; }
    .perms li { list-style: none; padding: .3rem 0; color: #444; font-size: .9rem; }
    .perms li::before { content: "✓ "; color: #2d6a4f; font-weight: bold; }
    .btn { display: inline-block; width: 100%; padding: .85rem;
           border: none; border-radius: .75rem; font-size: 1rem;
           cursor: pointer; font-weight: 600; transition: opacity .15s; }
    .btn:hover { opacity: .88; }
    .allow { background: #2d6a4f; color: white; margin-bottom: .75rem; }
    .deny  { background: #eee; color: #444; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📚</div>
    <h1>Allow Claude to access Vocab</h1>
    <p>Claude will be able to read your vocabulary data to answer questions about your learning.</p>
    <ul class="perms">
      <li>View saved words and meanings</li>
      <li>View vocab stats (counts, dates)</li>
      <li>View tracked books and notes</li>
    </ul>
    <form method="GET" action="/mcp/oauth/approve">
      <input type="hidden" name="session" value="${sessionToken}">
      <button type="submit" class="btn allow">Allow</button>
    </form>
    <a href="${redirect_uri}?error=access_denied&state=${encodeURIComponent(state || '')}" class="btn deny">Deny</a>
  </div>
</body>
</html>`);
});

// ── OAuth: approve (user clicked Allow) ───────────────────────────────────────
mcpRouter.get('/oauth/approve', (req, res) => {
  const { session } = req.query;
  const pending = authCodes[`_pending_${session}`];
  if (!pending || pending.expiresAt < Date.now()) {
    return res.status(400).send('Session expired. Go back and try again.');
  }
  delete authCodes[`_pending_${session}`];

  const code = crypto.randomBytes(20).toString('hex');
  authCodes[code] = {
    clientId: pending.clientId,
    codeChallenge: pending.codeChallenge,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
  };

  const url = new URL(pending.redirectUri);
  url.searchParams.set('code', code);
  if (pending.state) url.searchParams.set('state', pending.state);
  res.redirect(url.toString());
});

// ── OAuth: token exchange (public) ────────────────────────────────────────────
mcpRouter.post('/oauth/token', urlencoded({ extended: true }), json(), (req, res) => {
  const { code, code_verifier, grant_type } = req.body;

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  const authCode = authCodes[code];
  if (!authCode || authCode.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired or invalid' });
  }

  // Verify PKCE S256
  if (authCode.codeChallenge && code_verifier) {
    const expected = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (expected !== authCode.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
  }

  delete authCodes[code];

  // Return our static MCP_TOKEN as the Bearer access token
  res.json({
    access_token: process.env.MCP_TOKEN,
    token_type: 'Bearer',
    expires_in: 86400 * 30,
  });
});

// ── Auth middleware (protects SSE + messages only) ────────────────────────────
mcpRouter.use(['/sse', '/messages'], (req, res, next) => {
  const token =
    req.query.token ||
    req.headers['x-mcp-token'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!process.env.MCP_TOKEN || token !== process.env.MCP_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// ── MCP Server + Tools ────────────────────────────────────────────────────────
const server = new McpServer({ name: 'vocab', version: '1.0.0' });

server.tool(
  'get_stats',
  'Get vocabulary stats: total words saved, words learned this week and this month, plus books count.',
  {},
  async () => {
    const { rows: w } = await db.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN saved_at >= datetime('now','-7 days')  THEN 1 ELSE 0 END) as week,
        SUM(CASE WHEN saved_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) as month
      FROM words
    `);
    const { rows: b } = await db.execute('SELECT COUNT(*) as total FROM books');
    const r = w[0];
    return {
      content: [{
        type: 'text',
        text: [
          `📚 Vocabulary stats:`,
          `• Total words saved: ${Number(r.total)}`,
          `• Learned this week: ${Number(r.week)}`,
          `• Learned this month: ${Number(r.month)}`,
          `• Books tracked: ${Number(b[0].total)}`,
        ].join('\n'),
      }],
    };
  }
);

server.tool(
  'get_recent_words',
  'Get the most recently saved vocabulary words with their meanings.',
  { count: z.number().min(1).max(50).default(10).describe('How many recent words to return') },
  async ({ count }) => {
    const { rows } = await db.execute({
      sql: 'SELECT word, meaning, saved_at FROM words ORDER BY saved_at DESC LIMIT ?',
      args: [count],
    });
    if (!rows.length) return { content: [{ type: 'text', text: 'No words saved yet.' }] };
    const lines = rows.map((r, i) =>
      `${i + 1}. **${r.word}** — ${r.meaning}\n   _saved ${new Date(r.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}_`
    );
    return { content: [{ type: 'text', text: `Recent ${rows.length} words:\n\n${lines.join('\n\n')}` }] };
  }
);

server.tool(
  'search_word',
  'Look up a word in your saved vocabulary — returns meaning, sentence, synonyms, antonyms.',
  { word: z.string().describe('The word to look up') },
  async ({ word }) => {
    const { rows } = await db.execute({
      sql: 'SELECT * FROM words WHERE word = ?',
      args: [word.toLowerCase().trim()],
    });
    if (!rows.length) return { content: [{ type: 'text', text: `"${word}" is not in your vocabulary yet.` }] };
    const r = rows[0];
    const syns = JSON.parse(r.synonyms || '[]');
    const ants = JSON.parse(r.antonyms || '[]');
    return {
      content: [{
        type: 'text',
        text: [
          `**${r.word}**`,
          `Meaning: ${r.meaning}`,
          r.sentence ? `Sentence: "${r.sentence}"` : null,
          syns.length ? `Synonyms: ${syns.join(', ')}` : null,
          ants.length ? `Antonyms: ${ants.join(', ')}` : null,
        ].filter(Boolean).join('\n'),
      }],
    };
  }
);

server.tool(
  'get_words_this_week',
  'List every word saved in the last 7 days.',
  {},
  async () => {
    const { rows } = await db.execute(
      `SELECT word, meaning, saved_at FROM words WHERE saved_at >= datetime('now','-7 days') ORDER BY saved_at DESC`
    );
    if (!rows.length) return { content: [{ type: 'text', text: 'No words saved in the last 7 days.' }] };
    const lines = rows.map(r => `• **${r.word}** — ${r.meaning}`);
    return { content: [{ type: 'text', text: `Words saved this week (${rows.length}):\n\n${lines.join('\n')}` }] };
  }
);

server.tool(
  'get_books',
  'List all books being tracked with their note counts.',
  {},
  async () => {
    const { rows } = await db.execute(`
      SELECT b.title, b.added_at, COUNT(n.id) as note_count
      FROM books b LEFT JOIN notes n ON n.book_id = b.id
      GROUP BY b.id ORDER BY b.added_at DESC
    `);
    if (!rows.length) return { content: [{ type: 'text', text: 'No books tracked yet.' }] };
    const lines = rows.map(r => `• **${r.title}** — ${Number(r.note_count)} note${r.note_count === 1 ? '' : 's'}`);
    return { content: [{ type: 'text', text: `Books (${rows.length}):\n\n${lines.join('\n')}` }] };
  }
);

// ── SSE Transport ─────────────────────────────────────────────────────────────
const transports = {};

mcpRouter.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  transports[transport.sessionId] = transport;
  res.on('close', () => delete transports[transport.sessionId]);
  await server.connect(transport);
});

mcpRouter.post('/messages', async (req, res) => {
  const transport = transports[req.query.sessionId];
  if (!transport) return res.status(400).json({ error: 'unknown session' });
  await transport.handlePostMessage(req, res);
});
