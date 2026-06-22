import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM words ORDER BY saved_at DESC').all();
  res.json(rows.map(r => ({
    word: r.word,
    meaning: r.meaning,
    sentence: r.sentence,
    synonyms: JSON.parse(r.synonyms || '[]'),
    antonyms: JSON.parse(r.antonyms || '[]'),
    savedAt: r.saved_at,
  })));
});

export default router;
