import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import express, { Router } from 'express';
import crypto from 'crypto';
import { db } from './db.js';

export const mcpRouter = Router();
const { json, urlencoded } = express;

const BASE_URL = 'https://vocab.aman-n8n.site/mcp';

// Log every incoming MCP request for debugging
mcpRouter.use((req, _res, next) => {
  console.log(`[MCP] ${req.method} ${req.path} | auth: ${req.headers.authorization ? 'Bearer ***' : req.query.token ? 'query-token' : 'none'}`);
  next();
});

// ── In-memory OAuth state ─────────────────────────────────────────────────────
const oauthClients = {};
const authCodes = {};

// ── OAuth: metadata discovery (public) ───────────────────────────────────────
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
  console.log('[MCP] register body:', JSON.stringify(req.body));
  const clientId = crypto.randomUUID();
  oauthClients[clientId] = req.body;
  const response = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
    ...req.body,
  };
  console.log('[MCP] register response:', JSON.stringify(response));
  res.status(201).json(response);
});

// ── OAuth: authorization page (public) ────────────────────────────────────────
mcpRouter.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, state, code_challenge } = req.query;
  if (!redirect_uri) return res.status(400).send('Missing redirect_uri');

  const sessionToken = crypto.randomBytes(16).toString('hex');
  authCodes[`_pending_${sessionToken}`] = {
    redirectUri: redirect_uri,
    state: state || '',
    codeChallenge: code_challenge || '',
    expiresAt: Date.now() + 10 * 60 * 1000,
  };

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vocab — Authorize Claude</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#f5f0e4;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:white;border-radius:1.25rem;padding:2.5rem 2rem;max-width:380px;
          width:90%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1)}
    .icon{font-size:3rem;margin-bottom:1rem}
    h1{font-size:1.4rem;margin-bottom:.5rem;color:#1a1a1a}
    p{color:#555;line-height:1.5;margin-bottom:1.5rem;font-size:.95rem}
    .perms{background:#f9f7f2;border-radius:.75rem;padding:1rem;text-align:left;margin-bottom:1.5rem}
    .perms li{list-style:none;padding:.3rem 0;color:#444;font-size:.9rem}
    .perms li::before{content:"✓ ";color:#2d6a4f;font-weight:bold}
    .btn{display:block;width:100%;padding:.85rem;border:none;border-radius:.75rem;
         font-size:1rem;cursor:pointer;font-weight:600;transition:opacity .15s;text-decoration:none;
         text-align:center;margin-bottom:.75rem}
    .btn:hover{opacity:.85}
    .allow{background:#2d6a4f;color:white}
    .deny{background:#eee;color:#444}
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
    <a href="/mcp/oauth/approve?session=${sessionToken}" class="btn allow">Allow</a>
    <a href="${encodeURIComponent(redirect_uri)}?error=access_denied&state=${encodeURIComponent(state || '')}" class="btn deny">Deny</a>
  </div>
</body>
</html>`);
});

// ── OAuth: approve handler ─────────────────────────────────────────────────────
mcpRouter.get('/oauth/approve', (req, res) => {
  const { session } = req.query;
  const pending = authCodes[`_pending_${session}`];
  if (!pending || pending.expiresAt < Date.now()) {
    return res.status(400).send('Session expired. Go back and try again.');
  }
  delete authCodes[`_pending_${session}`];

  const code = crypto.randomBytes(20).toString('hex');
  authCodes[code] = {
    codeChallenge: pending.codeChallenge,
    expiresAt: Date.now() + 5 * 60 * 1000,
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
    return res.status(400).json({ error: 'invalid_grant' });
  }
  if (authCode.codeChallenge && code_verifier) {
    const expected = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (expected !== authCode.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }
  delete authCodes[code];

  res.json({
    access_token: process.env.MCP_TOKEN,
    token_type: 'Bearer',
    expires_in: 86400 * 30,
  });
});

// ── Auth middleware (for MCP endpoints only) ──────────────────────────────────
function requireAuth(req, res, next) {
  const token =
    req.query.token ||
    req.headers['x-mcp-token'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!process.env.MCP_TOKEN || token !== process.env.MCP_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ── Tool registration (shared across sessions) ────────────────────────────────
function registerTools(server) {
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

  server.tool(
    'get_book_notes',
    'Get all notes saved for a specific book. Use get_books first if you need to check exact book titles.',
    { title: z.string().describe('The book title to fetch notes for (partial match supported)') },
    async ({ title }) => {
      const { rows: books } = await db.execute({
        sql: `SELECT * FROM books WHERE title LIKE ? ORDER BY added_at DESC LIMIT 1`,
        args: [`%${title}%`],
      });
      if (!books.length) return { content: [{ type: 'text', text: `No book found matching "${title}".` }] };
      const book = books[0];
      const { rows: notes } = await db.execute({
        sql: `SELECT text, created_at FROM notes WHERE book_id = ? ORDER BY created_at ASC`,
        args: [book.id],
      });
      if (!notes.length) return { content: [{ type: 'text', text: `**${book.title}** has no notes yet.` }] };
      const lines = notes.map((n, i) =>
        `${i + 1}. ${n.text}\n   _${new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}_`
      );
      return { content: [{ type: 'text', text: `Notes for **${book.title}** (${notes.length}):\n\n${lines.join('\n\n')}` }] };
    }
  );
}

// ── Streamable HTTP transport (stateful sessions) ─────────────────────────────
const sessions = new Map(); // sessionId → transport

mcpRouter.post('/', requireAuth, async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];

    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const server = new McpServer({ name: 'vocab', version: '1.0.0' });
    registerTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP POST error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'internal server error' });
  }
});

mcpRouter.get('/', requireAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = sessions.get(sessionId);
  if (!transport) return res.status(404).json({ error: 'session not found' });
  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('MCP GET error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'internal server error' });
  }
});

mcpRouter.delete('/', requireAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = sessions.get(sessionId);
  if (transport) {
    await transport.close();
    sessions.delete(sessionId);
  }
  res.status(200).end();
});
