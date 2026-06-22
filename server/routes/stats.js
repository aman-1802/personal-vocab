import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const totalWords = db.prepare('SELECT COUNT(*) as n FROM words').get().n;
  const totalBooks = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  const wordsLast7 = db.prepare(
    "SELECT COUNT(*) as n FROM words WHERE saved_at >= datetime('now', '-7 days')"
  ).get().n;
  const wordsLast30 = db.prepare(
    "SELECT COUNT(*) as n FROM words WHERE saved_at >= datetime('now', '-30 days')"
  ).get().n;

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = db.prepare("SELECT COUNT(*) as n FROM words WHERE date(saved_at) = ?").get(dateStr).n;
    last7Days.push({
      label: d.toLocaleDateString('en-US', { weekday: 'short' })[0],
      count,
      isToday: i === 0,
    });
  }

  res.json({ totalWords, totalBooks, wordsLast7, wordsLast30, last7Days });
});

export default router;
