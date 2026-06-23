import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

async function withNotes(book) {
  const { rows } = await db.execute({
    sql: 'SELECT * FROM notes WHERE book_id = ? ORDER BY created_at ASC',
    args: [book.id],
  });
  return {
    id: book.id,
    title: book.title,
    addedAt: book.added_at,
    notes: rows.map(n => ({ id: n.id, text: n.text, at: n.created_at })),
  };
}

router.get('/', async (_req, res) => {
  const { rows } = await db.execute('SELECT * FROM books ORDER BY added_at DESC');
  res.json(await Promise.all(rows.map(withNotes)));
});

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const book = { id: Date.now().toString(), title: title.trim(), added_at: new Date().toISOString() };
  await db.execute({ sql: 'INSERT INTO books (id, title, added_at) VALUES (?, ?, ?)', args: [book.id, book.title, book.added_at] });
  res.json(await withNotes(book));
});

router.get('/:id', async (req, res) => {
  const { rows } = await db.execute({ sql: 'SELECT * FROM books WHERE id = ?', args: [req.params.id] });
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(await withNotes(rows[0]));
});

router.post('/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const { rows } = await db.execute({ sql: 'SELECT * FROM books WHERE id = ?', args: [req.params.id] });
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await db.execute({
    sql: 'INSERT INTO notes (id, book_id, text, created_at) VALUES (?, ?, ?, ?)',
    args: [Date.now().toString(), req.params.id, text.trim(), new Date().toISOString()],
  });
  res.json(await withNotes(rows[0]));
});

router.patch('/:bookId/notes/:noteId', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  await db.execute({ sql: 'UPDATE notes SET text = ? WHERE id = ? AND book_id = ?', args: [text.trim(), req.params.noteId, req.params.bookId] });
  const { rows } = await db.execute({ sql: 'SELECT * FROM books WHERE id = ?', args: [req.params.bookId] });
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(await withNotes(rows[0]));
});

router.delete('/:bookId/notes/:noteId', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM notes WHERE id = ? AND book_id = ?', args: [req.params.noteId, req.params.bookId] });
  const { rows } = await db.execute({ sql: 'SELECT * FROM books WHERE id = ?', args: [req.params.bookId] });
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(await withNotes(rows[0]));
});

export default router;
