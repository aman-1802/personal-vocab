import { Router } from 'express';
import db from '../db.js';

const router = Router();

function withNotes(book) {
  const notes = db
    .prepare('SELECT * FROM notes WHERE book_id = ? ORDER BY created_at ASC')
    .all(book.id);
  return {
    id: book.id,
    title: book.title,
    addedAt: book.added_at,
    notes: notes.map(n => ({ text: n.text, at: n.created_at })),
  };
}

router.get('/', (_req, res) => {
  const books = db.prepare('SELECT * FROM books ORDER BY added_at DESC').all();
  res.json(books.map(withNotes));
});

router.post('/', (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const book = {
    id: Date.now().toString(),
    title: title.trim(),
    added_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO books (id, title, added_at) VALUES (@id, @title, @added_at)').run(book);
  res.json(withNotes(book));
});

router.get('/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'not found' });
  res.json(withNotes(book));
});

router.post('/:id/notes', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'not found' });
  db.prepare(
    'INSERT INTO notes (id, book_id, text, created_at) VALUES (@id, @book_id, @text, @created_at)'
  ).run({
    id: Date.now().toString(),
    book_id: req.params.id,
    text: text.trim(),
    created_at: new Date().toISOString(),
  });
  res.json(withNotes(book));
});

export default router;
