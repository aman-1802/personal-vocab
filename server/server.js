import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { initDb } from './db.js';
import lookupRouter from './routes/lookup.js';
import wordsRouter from './routes/words.js';
import booksRouter from './routes/books.js';
import statsRouter from './routes/stats.js';
import graphRouter from './routes/graph.js';
import { mcpRouter } from './mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/lookup', lookupRouter);
app.use('/api/words', wordsRouter);
app.use('/api/books', booksRouter);
app.use('/api/stats', statsRouter);
app.use('/api/graph', graphRouter);
// OAuth discovery — RFC 8414 path-suffix form: /.well-known/oauth-authorization-server/{path}
// Claude.ai constructs this as /.well-known/oauth-authorization-server/mcp for our /mcp base URL
const oauthMeta = {
  issuer: 'https://vocab.aman-n8n.site/mcp',
  authorization_endpoint: 'https://vocab.aman-n8n.site/mcp/oauth/authorize',
  token_endpoint: 'https://vocab.aman-n8n.site/mcp/oauth/token',
  registration_endpoint: 'https://vocab.aman-n8n.site/mcp/oauth/register',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
};
app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(oauthMeta));
app.get('/.well-known/oauth-authorization-server/mcp', (_req, res) => res.json(oauthMeta));

app.use('/mcp', mcpRouter);

const distDir = join(__dirname, '../client/dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')));
}

await initDb();
app.listen(PORT, () => console.log(`vocab server on :${PORT}`));
