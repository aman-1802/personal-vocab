import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { Router } from 'express';
import { db } from './db.js';

export const mcpRouter = Router();

const server = new McpServer({ name: 'vocab', version: '1.0.0' });

// ── Tools ────────────────────────────────────────────────────────────────────

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

// ── Auth middleware ───────────────────────────────────────────────────────────

mcpRouter.use((req, res, next) => {
  const token = req.query.token || req.headers['x-mcp-token'];
  if (!process.env.MCP_TOKEN || token !== process.env.MCP_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

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
