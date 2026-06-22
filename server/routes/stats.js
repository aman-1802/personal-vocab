import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [tw, tb, w7, w30] = await Promise.all([
    db.execute('SELECT COUNT(*) as n FROM words'),
    db.execute('SELECT COUNT(*) as n FROM books'),
    db.execute("SELECT COUNT(*) as n FROM words WHERE saved_at >= datetime('now', '-7 days')"),
    db.execute("SELECT COUNT(*) as n FROM words WHERE saved_at >= datetime('now', '-30 days')"),
  ]);

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const { rows } = await db.execute({ sql: "SELECT COUNT(*) as n FROM words WHERE date(saved_at) = ?", args: [dateStr] });
    last7Days.push({
      label: d.toLocaleDateString('en-US', { weekday: 'short' })[0],
      count: Number(rows[0].n),
      isToday: i === 0,
    });
  }

  res.json({
    totalWords: Number(tw.rows[0].n),
    totalBooks: Number(tb.rows[0].n),
    wordsLast7: Number(w7.rows[0].n),
    wordsLast30: Number(w30.rows[0].n),
    last7Days,
  });
});

export default router;
