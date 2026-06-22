import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await db.execute('SELECT word, meaning, synonyms FROM words');

  const wordSet = new Set(rows.map(r => r.word));

  const nodes = rows.map(r => ({
    id: r.word,
    meaning: r.meaning,
  }));

  const seen = new Set();
  const links = [];

  for (const row of rows) {
    const syns = JSON.parse(row.synonyms || '[]');
    for (const syn of syns) {
      const t = syn.toLowerCase();
      if (wordSet.has(t) && t !== row.word) {
        const key = [row.word, t].sort().join('||');
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: row.word, target: t });
        }
      }
    }
  }

  res.json({ nodes, links });
});

export default router;
