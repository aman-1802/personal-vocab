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
app.use('/mcp', mcpRouter);

const distDir = join(__dirname, '../client/dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')));
}

await initDb();
app.listen(PORT, () => console.log(`vocab server on :${PORT}`));
