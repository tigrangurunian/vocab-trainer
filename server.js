import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vocab.db');

// Initialize DB
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  fr TEXT NOT NULL,
  en TEXT NOT NULL, -- JSON array as text
  errors INTEGER NOT NULL DEFAULT 0,
  errors_by_user TEXT, -- JSON object as text
  created_at INTEGER NOT NULL,
  FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  unique_words INTEGER NOT NULL,
  errors_total INTEGER NOT NULL,
  avg_ms_overall INTEGER NOT NULL,
  first_pass_pct INTEGER NOT NULL,
  per_word TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const getKvStmt = db.prepare('SELECT value FROM kv WHERE key = ?');
const putKvStmt = db.prepare(`
  INSERT INTO kv (key, value, updated_at)
  VALUES (@key, @value, strftime('%s','now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const listKvStmt = db.prepare('SELECT key, updated_at FROM kv ORDER BY key');
const delKvStmt = db.prepare('DELETE FROM kv WHERE key = ?');
// Users prepared statements
const listUsersStmt = db.prepare('SELECT id, name, created_at FROM users ORDER BY created_at ASC');
const getUserByNameStmt = db.prepare('SELECT id FROM users WHERE lower(trim(name)) = lower(trim(?))');
const insertUserStmt = db.prepare('INSERT INTO users (id, name, created_at) VALUES (@id, @name, @created_at)');
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');
// User prefs prepared statements
const getPrefsStmt = db.prepare('SELECT data FROM user_prefs WHERE user_id = ?');
const upsertPrefsStmt = db.prepare(`
  INSERT INTO user_prefs (user_id, data, updated_at)
  VALUES (@user_id, @data, strftime('%s','now'))
  ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);
// Decks prepared statements
const listDecksStmt = db.prepare('SELECT id, name, created_at FROM decks ORDER BY created_at ASC');
const getDeckByNameStmt = db.prepare('SELECT id FROM decks WHERE lower(trim(name)) = lower(trim(?))');
const insertDeckStmt = db.prepare('INSERT INTO decks (id, name, created_at) VALUES (@id, @name, @created_at)');
const deleteDeckStmt = db.prepare('DELETE FROM decks WHERE id = ?');
// Words prepared statements
const listWordsByDeckStmt = db.prepare('SELECT id, fr, en, errors, errors_by_user, created_at FROM words WHERE deck_id = ? ORDER BY created_at ASC');
const insertWordStmt = db.prepare('INSERT INTO words (id, deck_id, fr, en, errors, errors_by_user, created_at) VALUES (@id, @deck_id, @fr, @en, @errors, @errors_by_user, @created_at)');
const deleteWordStmt = db.prepare('DELETE FROM words WHERE id = ?');
const clearWordsByDeckStmt = db.prepare('DELETE FROM words WHERE deck_id = ?');
// Reviews prepared statements
const listReviewsByDeckStmt = db.prepare('SELECT id, deck_id, user_id, started_at, ended_at, duration_ms, total_questions, unique_words, errors_total, avg_ms_overall, first_pass_pct, per_word, created_at FROM reviews WHERE deck_id = ? ORDER BY started_at ASC');
const insertReviewStmt = db.prepare(`INSERT INTO reviews (id, deck_id, user_id, started_at, ended_at, duration_ms, total_questions, unique_words, errors_total, avg_ms_overall, first_pass_pct, per_word, created_at) VALUES (@id, @deck_id, @user_id, @started_at, @ended_at, @duration_ms, @total_questions, @unique_words, @errors_total, @avg_ms_overall, @first_pass_pct, @per_word, @created_at)`);
const clearReviewsByDeckStmt = db.prepare('DELETE FROM reviews WHERE deck_id = ?');

// App
const app = express();
app.use(express.json({ limit: '2mb' }));

// Health
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
// Reviews API
// GET /api/decks/:deckId/reviews -> { items: [...] }
app.get('/api/decks/:deckId/reviews', (req, res) => {
  try {
    const deckId = String(req.params.deckId);
    const rows = listReviewsByDeckStmt.all(deckId).map(r => ({
      id: r.id,
      deckId: r.deck_id,
      userId: r.user_id,
      startedAt: r.started_at * 1000,
      endedAt: r.ended_at * 1000,
      durationMs: r.duration_ms,
      totalQuestions: r.total_questions,
      uniqueWords: r.unique_words,
      perWord: JSON.parse(r.per_word || '{}'),
      summary: {
        errorsTotal: r.errors_total,
        avgMsOverall: r.avg_ms_overall,
        firstPassPct: r.first_pass_pct
      },
      createdAt: r.created_at * 1000
    }));
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reviews body: review record
app.post('/api/reviews', (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.id || ('r_' + Math.random().toString(36).slice(2) + Date.now().toString(36)));
    const deck_id = String(b.deckId);
    const user_id = String(b.userId);
    const started_at = Math.floor((b.startedAt || Date.now()) / 1000);
    const ended_at = Math.floor((b.endedAt || Date.now()) / 1000);
    const duration_ms = Number(b.durationMs || 0);
    const total_questions = Number(b.totalQuestions || 0);
    const unique_words = Number(b.uniqueWords || 0);
    const errors_total = Number(b.summary?.errorsTotal || 0);
    const avg_ms_overall = Number(b.summary?.avgMsOverall || 0);
    const first_pass_pct = Number(b.summary?.firstPassPct || 0);
    const per_word = JSON.stringify(b.perWord || {});
    const created_at = Math.floor(Date.now()/1000);
    if (!deck_id || !user_id) return res.status(400).json({ error: 'deckId_userId_required' });
    insertReviewStmt.run({ id, deck_id, user_id, started_at, ended_at, duration_ms, total_questions, unique_words, errors_total, avg_ms_overall, first_pass_pct, per_word, created_at });
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/decks/:deckId/reviews -> clear all reviews for deck
app.delete('/api/decks/:deckId/reviews', (req, res) => {
  try {
    const deckId = String(req.params.deckId);
    const info = clearReviewsByDeckStmt.run(deckId);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Ensure a default user exists at startup
function ensureDefaultUser() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    const def = { id: 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36), name: 'Alex', created_at: Math.floor(Date.now()/1000) };
    insertUserStmt.run(def);
    // seed default prefs for Alex
    const defaultPrefs = {
      shuffle: true,
      fireworks: true,
      theme: 'dark',
      mascot: '🦊',
      celebrateImageEnabled: false,
      celebrateImageData: null,
      selectedDeckId: null,
      selectedUserId: def.id
    };
    upsertPrefsStmt.run({ user_id: def.id, data: JSON.stringify(defaultPrefs) });
  }
}
ensureDefaultUser();

// Ensure at least one deck exists for convenience
function ensureDefaultDeck() {
  const count = db.prepare('SELECT COUNT(*) as c FROM decks').get().c;
  if (count === 0) {
    const id = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    insertDeckStmt.run({ id, name: 'Vocab par défaut', created_at: Math.floor(Date.now()/1000) });
  }
}
ensureDefaultDeck();

// List keys
// GET /api/kv -> { items: [{ key, updated_at }] }
app.get('/api/kv', (req, res) => {
  try {
    const rows = listKvStmt.all();
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Simple key/value API to mirror localStorage keys
// GET /api/kv/:key -> { key, value }
app.get('/api/kv/:key', (req, res) => {
  try {
    const key = String(req.params.key);
    const row = getKvStmt.get(key);
    if (!row) return res.status(404).json({ error: 'not_found' });
    let value;
    try { value = JSON.parse(row.value); } catch { value = row.value; }
    res.json({ key, value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/kv/:key  body: { value }
app.put('/api/kv/:key', (req, res) => {
  try {
    const key = String(req.params.key);
    const value = req.body?.value;
    const payload = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    putKvStmt.run({ key, value: payload });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/kv/:key
app.delete('/api/kv/:key', (req, res) => {
  try {
    const key = String(req.params.key);
    const info = delKvStmt.run(key);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Users API
// GET /api/users -> { items: [{ id, name, created_at }] }
app.get('/api/users', (req, res) => {
  try {
    const rows = listUsersStmt.all();
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/users  body: { name }
app.post('/api/users', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    const exists = getUserByNameStmt.get(name);
    if (exists) return res.status(409).json({ error: 'name_exists' });
    const id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const created_at = Math.floor(Date.now()/1000);
    insertUserStmt.run({ id, name, created_at });
    // seed default prefs for this user
    const defaultPrefs = {
      shuffle: true,
      fireworks: true,
      theme: 'dark',
      mascot: '🦊',
      celebrateImageEnabled: false,
      celebrateImageData: null,
      selectedDeckId: null,
      selectedUserId: id
    };
    upsertPrefsStmt.run({ user_id: id, data: JSON.stringify(defaultPrefs) });
    res.status(201).json({ id, name, created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:id
app.delete('/api/users/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const info = deleteUserStmt.run(id);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User preferences API
// GET /api/users/:id/prefs -> { userId, prefs }
app.get('/api/users/:id/prefs', (req, res) => {
  try {
    const id = String(req.params.id);
    const row = getPrefsStmt.get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    let prefs;
    try { prefs = JSON.parse(row.data); } catch { prefs = {}; }
    res.json({ userId: id, prefs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:id/prefs  body: { prefs }
app.put('/api/users/:id/prefs', (req, res) => {
  try {
    const id = String(req.params.id);
    const prefs = req.body?.prefs ?? {};
    const payload = typeof prefs === 'string' ? prefs : JSON.stringify(prefs);
    upsertPrefsStmt.run({ user_id: id, data: payload });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Decks API
// GET /api/decks -> { items: [{ id, name, created_at }] }
app.get('/api/decks', (req, res) => {
  try {
    const rows = listDecksStmt.all();
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/decks  body: { name }
app.post('/api/decks', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    const exists = getDeckByNameStmt.get(name);
    if (exists) return res.status(409).json({ error: 'name_exists' });
    const id = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    insertDeckStmt.run({ id, name, created_at: Math.floor(Date.now()/1000) });
    res.status(201).json({ id, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/decks/:id
app.delete('/api/decks/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const info = deleteDeckStmt.run(id);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Words API
// GET /api/decks/:deckId/words -> { items: [...] }
app.get('/api/decks/:deckId/words', (req, res) => {
  try {
    const deckId = String(req.params.deckId);
    const rows = listWordsByDeckStmt.all(deckId).map(r => ({
      id: r.id,
      fr: r.fr,
      en: JSON.parse(r.en || '[]'),
      errors: r.errors || 0,
      errorsByUser: r.errors_by_user ? JSON.parse(r.errors_by_user) : {},
      createdAt: (r.created_at || 0) * 1000
    }));
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/decks/:deckId/words  body: { fr, en: [] }
app.post('/api/decks/:deckId/words', (req, res) => {
  try {
    const deckId = String(req.params.deckId);
    const fr = String(req.body?.fr || '').trim();
    let en = req.body?.en;
    if (!fr) return res.status(400).json({ error: 'fr_required' });
    if (!Array.isArray(en)) en = en ? [String(en)] : [];
    const id = 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    insertWordStmt.run({
      id,
      deck_id: deckId,
      fr,
      en: JSON.stringify(en.map(String)),
      errors: 0,
      errors_by_user: JSON.stringify({}),
      created_at: Math.floor(Date.now()/1000)
    });
    res.status(201).json({ id, fr, en });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/words/:id
app.delete('/api/words/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const info = deleteWordStmt.run(id);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/decks/:deckId/words  (clear all words in deck)
app.delete('/api/decks/:deckId/words', (req, res) => {
  try {
    const deckId = String(req.params.deckId);
    const info = clearWordsByDeckStmt.run(deckId);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Serve static files (frontend) from project root
app.use(express.static(__dirname));

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Fallback to index.html for root
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vocab Trainer server listening on http://127.0.0.1:${PORT}`);
});
