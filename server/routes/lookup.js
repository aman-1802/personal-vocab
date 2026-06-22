import { Router } from 'express';
import OpenAI from 'openai';
import { db } from '../db.js';

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/', async (req, res) => {
  const raw = (req.body.word || '').trim().toLowerCase();
  if (!raw) return res.status(400).json({ error: 'word is required' });

  const { rows } = await db.execute({ sql: 'SELECT * FROM words WHERE word = ?', args: [raw] });
  if (rows[0]) {
    const r = rows[0];
    return res.json({
      word: r.word, meaning: r.meaning, sentence: r.sentence,
      synonyms: JSON.parse(r.synonyms || '[]'),
      antonyms: JSON.parse(r.antonyms || '[]'),
      savedAt: r.saved_at, isNew: false,
    });
  }

  const prompt = `The user is reading a book and came across the word "${raw}".
Respond with ONLY valid JSON, no markdown, exactly:
{"word":"...","meaning":"...","sentence":"...","synonyms":["..."],"antonyms":["..."]}
- meaning: plain everyday English like texting a smart friend, 1-2 short sentences, no jargon, no part-of-speech.
- sentence: one natural example using the word.
- synonyms: 3-5 simple words. antonyms: 2-4, empty array if none.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const savedAt = new Date().toISOString();

    await db.execute({
      sql: 'INSERT OR REPLACE INTO words (word, meaning, sentence, synonyms, antonyms, saved_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [parsed.word || raw, parsed.meaning, parsed.sentence,
             JSON.stringify(parsed.synonyms || []), JSON.stringify(parsed.antonyms || []), savedAt],
    });

    res.json({
      word: parsed.word || raw, meaning: parsed.meaning, sentence: parsed.sentence,
      synonyms: parsed.synonyms || [], antonyms: parsed.antonyms || [],
      savedAt, isNew: true,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Couldn't look that up. Try again?" });
  }
});

export default router;
