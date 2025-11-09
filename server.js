import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vocab.db');

// Initialize DB
console.log('[Startup] DB_PATH in use:', DB_PATH);
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

// Migration: add is_public column to decks if missing (default public)
try {
  const cols = db.prepare("PRAGMA table_info('decks')").all();
  const hasIsPublic = cols.some(c => String(c.name) === 'is_public');
  if (!hasIsPublic) {
    db.exec("ALTER TABLE decks ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1");
    db.exec("UPDATE decks SET is_public = 1 WHERE is_public IS NULL");
  }
} catch (e) { console.warn('Deck privacy migration failed:', e.message); }

// Migration: add owner_user_id to decks to support private ownership
try {
  const dcols = db.prepare("PRAGMA table_info('decks')").all();
  const hasOwner = dcols.some(c => String(c.name) === 'owner_user_id');
  if (!hasOwner) {
    db.exec("ALTER TABLE decks ADD COLUMN owner_user_id TEXT NULL");
  }
} catch (e) { console.warn('Deck owner migration failed:', e.message); }

// Migration: add authentication/admin fields to users if missing
try {
  const ucols = db.prepare("PRAGMA table_info('users')").all();
  const hasUser = ucols.some(c => String(c.name) === 'user');
  const hasPassword = ucols.some(c => String(c.name) === 'password');
  const hasIsAdmin = ucols.some(c => String(c.name) === 'is_admin');
  if (!hasUser) {
    db.exec("ALTER TABLE users ADD COLUMN user TEXT");
  }
  if (!hasPassword) {
    db.exec("ALTER TABLE users ADD COLUMN password TEXT");
  }
  if (!hasIsAdmin) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
} catch (e) { console.warn('Users auth/admin migration failed:', e.message); }

const getKvStmt = db.prepare('SELECT value FROM kv WHERE key = ?');
const putKvStmt = db.prepare(`
  INSERT INTO kv (key, value, updated_at)
  VALUES (@key, @value, strftime('%s','now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const listKvStmt = db.prepare('SELECT key, updated_at FROM kv ORDER BY key');
const delKvStmt = db.prepare('DELETE FROM kv WHERE key = ?');
// Users prepared statements
const listUsersStmt = db.prepare('SELECT id, name, created_at, user, is_admin FROM users ORDER BY created_at ASC');
const getUserByNameStmt = db.prepare('SELECT id FROM users WHERE lower(trim(name)) = lower(trim(?))');
const insertUserStmt = db.prepare('INSERT INTO users (id, name, created_at, user, password, is_admin) VALUES (@id, @name, @created_at, @user, @password, @is_admin)');
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');
const getUserByIdStmt = db.prepare('SELECT id, name, created_at, user, password, is_admin FROM users WHERE id = ?');
const updateUserAllStmt = db.prepare('UPDATE users SET name = @name, user = @user, password = @password, is_admin = @is_admin WHERE id = @id');
// User prefs prepared statements
const getPrefsStmt = db.prepare('SELECT data FROM user_prefs WHERE user_id = ?');
const upsertPrefsStmt = db.prepare(`
  INSERT INTO user_prefs (user_id, data, updated_at)
  VALUES (@user_id, @data, strftime('%s','now'))
  ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);
// Decks prepared statements
const listPublicDecksStmt = db.prepare('SELECT id, name, created_at, COALESCE(is_public,1) as is_public, owner_user_id FROM decks WHERE COALESCE(is_public,1)=1 ORDER BY created_at ASC');
const listDecksForUserStmt = db.prepare('SELECT id, name, created_at, COALESCE(is_public,1) as is_public, owner_user_id FROM decks WHERE COALESCE(is_public,1)=1 OR owner_user_id = ? ORDER BY created_at ASC');
const getDeckByNameStmt = db.prepare('SELECT id FROM decks WHERE lower(trim(name)) = lower(trim(?))');
const insertDeckStmt = db.prepare('INSERT INTO decks (id, name, created_at, is_public, owner_user_id) VALUES (@id, @name, @created_at, @is_public, @owner_user_id)');
const deleteDeckStmt = db.prepare('DELETE FROM decks WHERE id = ?');
const getDeckByIdStmt = db.prepare('SELECT id, name, created_at, COALESCE(is_public,1) as is_public, owner_user_id FROM decks WHERE id = ?');
const updateDeckPrivacyStmt = db.prepare('UPDATE decks SET is_public = @is_public WHERE id = @id');
// Words prepared statements
const listWordsByDeckStmt = db.prepare('SELECT id, fr, en, errors, errors_by_user, created_at FROM words WHERE deck_id = ? ORDER BY created_at ASC');
const insertWordStmt = db.prepare('INSERT INTO words (id, deck_id, fr, en, errors, errors_by_user, created_at) VALUES (@id, @deck_id, @fr, @en, @errors, @errors_by_user, @created_at)');
const deleteWordStmt = db.prepare('DELETE FROM words WHERE id = ?');
const clearWordsByDeckStmt = db.prepare('DELETE FROM words WHERE deck_id = ?');
const updateWordStmt = db.prepare('UPDATE words SET fr = @fr, en = @en WHERE id = @id');
// Reviews prepared statements
const listReviewsByDeckStmt = db.prepare('SELECT id, deck_id, user_id, started_at, ended_at, duration_ms, total_questions, unique_words, errors_total, avg_ms_overall, first_pass_pct, per_word, created_at FROM reviews WHERE deck_id = ? ORDER BY started_at ASC');
const insertReviewStmt = db.prepare(`INSERT INTO reviews (id, deck_id, user_id, started_at, ended_at, duration_ms, total_questions, unique_words, errors_total, avg_ms_overall, first_pass_pct, per_word, created_at) VALUES (@id, @deck_id, @user_id, @started_at, @ended_at, @duration_ms, @total_questions, @unique_words, @errors_total, @avg_ms_overall, @first_pass_pct, @per_word, @created_at)`);
const clearReviewsByDeckStmt = db.prepare('DELETE FROM reviews WHERE deck_id = ?');

// App
const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Minimal cookie parsing middleware ---
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers?.cookie || '';
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) {
      const k = decodeURIComponent(p.slice(0, i).trim());
      const v = decodeURIComponent(p.slice(i + 1).trim());
      req.cookies[k] = v;
    }
  });
  next();
});

function getAuthUserId(req) {
  const uid = req.cookies?.uid;
  return uid && typeof uid === 'string' && uid.startsWith('u_') ? uid : null;
}

// Health
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Auth: POST /api/login body: { user, password }
app.post('/api/login', (req, res) => {
  try {
    const login = String(req.body?.user || '').trim();
    const pwd = String(req.body?.password || '').trim();
    if (!login || !pwd) return res.status(400).json({ error: 'user_password_required' });
    const row = db.prepare('SELECT id, name, user, is_admin FROM users WHERE user = ? AND password = ?').get(login, pwd);
    if (!row) return res.status(401).json({ error: 'invalid_credentials' });
    // Set a simple cookie with user id (demo purposes only)
    const cookieVal = `uid=${encodeURIComponent(row.id)}; Path=/; SameSite=Lax; Max-Age=86400`;
    console.log('[Auth] login ok for', row.user || row.name, '-> set-cookie:', cookieVal);
    res.setHeader('Set-Cookie', cookieVal);
    res.json({ ok: true, user: { id: row.id, name: row.name, user: row.user, is_admin: row.is_admin } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Auth: POST /api/logout
app.post('/api/logout', (req, res) => {
  try {
    res.setHeader('Set-Cookie', 'uid=; Path=/; Max-Age=0; SameSite=Lax');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/me -> current logged user or null
app.get('/api/me', (req, res) => {
  try {
    const rawCookie = req.headers?.cookie || '';
    const uid = getAuthUserId(req);
    console.log('[Auth] /api/me cookies:', rawCookie, '-> uid:', uid || 'null');
    if (!uid) return res.json({ user: null });
    const row = db.prepare('SELECT id, name, user, is_admin FROM users WHERE id = ?').get(uid);
    if (!row) return res.json({ user: null });
    res.json({ user: row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/decks/:id/privacy  body: { isPublic: boolean }
app.put('/api/decks/:id/privacy', (req, res) => {
  try {
    const id = String(req.params.id);
    const isPublic = !!req.body?.isPublic;
    // If making private and no owner, attach to current user
    if (!isPublic) {
      const deck = getDeckByIdStmt.get(id);
      if (!deck) return res.status(404).json({ error: 'not_found' });
      if (!deck.owner_user_id) {
        const uid = getAuthUserId(req);
        if (uid) {
          db.prepare('UPDATE decks SET owner_user_id = ? WHERE id = ?').run(uid, id);
        }
      }
    }
    const info = updateDeckPrivacyStmt.run({ id, is_public: isPublic ? 1 : 0 });
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id, is_public: isPublic ? 1 : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/decks/:id/owner  body: { ownerId: string | null }
app.put('/api/decks/:id/owner', (req, res) => {
  try {
    const id = String(req.params.id);
    const ownerId = req.body?.ownerId ? String(req.body.ownerId) : null;
    const deck = getDeckByIdStmt.get(id);
    if (!deck) return res.status(404).json({ error: 'not_found' });
    // Verify owner exists if provided
    if (ownerId) {
      const owner = db.prepare('SELECT id FROM users WHERE id = ?').get(ownerId);
      if (!owner) return res.status(400).json({ error: 'owner_not_found' });
    }
    const info = db.prepare('UPDATE decks SET owner_user_id = ? WHERE id = ?').run(ownerId, id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id, owner_user_id: ownerId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/words/:id  body: { fr, en: [] }
app.put('/api/words/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const fr = String(req.body?.fr || '').trim();
    let en = req.body?.en;
    if (!fr) return res.status(400).json({ error: 'fr_required' });
    if (!Array.isArray(en)) en = en ? [String(en)] : [];
    const info = updateWordStmt.run({ id, fr, en: JSON.stringify(en.map(String)) });
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
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
    insertDeckStmt.run({ id, name: 'Vocab par défaut', created_at: Math.floor(Date.now()/1000), is_public: 1, owner_user_id: null });
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
    const userLogin = req.body?.user ? String(req.body.user) : null;
    const password = req.body?.password ? String(req.body.password) : null; // NOTE: store hashed in production
    const is_admin = req.body?.isAdmin ? 1 : 0;
    insertUserStmt.run({ id, name, created_at, user: userLogin, password, is_admin });
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
    res.status(201).json({ id, name, created_at, user: userLogin, is_admin });
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

// PUT /api/users/:id  body: { name?, user?, password?, isAdmin? }
app.put('/api/users/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const cur = getUserByIdStmt.get(id);
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const name = (req.body?.name !== undefined) ? String(req.body.name) : cur.name;
    const userLogin = (req.body?.user !== undefined) ? (req.body.user ? String(req.body.user) : null) : cur.user;
    const password = (req.body?.password !== undefined) ? (req.body.password ? String(req.body.password) : null) : cur.password;
    const is_admin = (req.body?.isAdmin !== undefined) ? (req.body.isAdmin ? 1 : 0) : cur.is_admin;
    updateUserAllStmt.run({ id, name, user: userLogin, password, is_admin });
    res.json({ ok: true, id, name, user: userLogin, is_admin });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User preferences API
// GET /api/users/:id/prefs -> { userId, prefs }
app.get('/api/users/:id/prefs', (req, res) => {
  try {
    const id = String(req.params.id);
    console.log('[Prefs] GET /api/users/:id/prefs - userId:', id);
    const row = getPrefsStmt.get(id);
    if (!row) {
      console.log('[Prefs] No prefs found for user:', id);
      return res.status(404).json({ error: 'not_found' });
    }
    let prefs;
    try { prefs = JSON.parse(row.data); } catch { prefs = {}; }
    console.log('[Prefs] Returning prefs for user:', id, '- mascot:', prefs.mascot);
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
    console.log('[Prefs] PUT /api/users/:id/prefs - userId:', id, '- mascot:', prefs.mascot);
    const payload = typeof prefs === 'string' ? prefs : JSON.stringify(prefs);
    upsertPrefsStmt.run({ user_id: id, data: payload });
    console.log('[Prefs] Prefs saved successfully for user:', id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Decks API
// GET /api/decks -> filters by auth: public OR owned by current user
app.get('/api/decks', (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const rows = uid ? listDecksForUserStmt.all(uid) : listPublicDecksStmt.all();
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
    const owner_user_id = getAuthUserId(req);
    insertDeckStmt.run({ id, name, created_at: Math.floor(Date.now()/1000), is_public: 1, owner_user_id });
    res.status(201).json({ id, name, is_public: 1, owner_user_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/decks/:id/copy  body: { name }
// Creates a new deck with the provided name and copies all words from the source deck.
app.post('/api/decks/:id/copy', (req, res) => {
  try {
    const sourceId = String(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    // Prevent duplicate deck names
    const exists = getDeckByNameStmt.get(name);
    if (exists) return res.status(409).json({ error: 'name_exists' });

    const newDeckId = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const nowSec = Math.floor(Date.now() / 1000);

    const tx = db.transaction(() => {
      // Create new deck
      const src = getDeckByIdStmt.get(sourceId);
      const srcPublic = src ? (src.is_public ? 1 : 0) : 1;
      const owner_user_id = getAuthUserId(req) || (src ? src.owner_user_id : null);
      insertDeckStmt.run({ id: newDeckId, name, created_at: nowSec, is_public: srcPublic, owner_user_id });
      // Copy words
      const words = listWordsByDeckStmt.all(sourceId);
      for (const w of words) {
        const newWordId = 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        insertWordStmt.run({
          id: newWordId,
          deck_id: newDeckId,
          fr: w.fr,
          en: w.en,
          errors: w.errors || 0,
          errors_by_user: w.errors_by_user || JSON.stringify({}),
          created_at: w.created_at || nowSec
        });
      }
      return { copied: words.length };
    });

    const result = tx();
    res.status(201).json({ id: newDeckId, name, copied: result.copied, is_public: getDeckByIdStmt.get(newDeckId)?.is_public ?? 1 });
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

// Text-to-Speech via Piper (server-side)
// Env vars required:
//  - PIPER_BIN: path to piper binary
//  - PIPER_MODEL_EN: path to English model (.onnx)
//  - PIPER_MODEL_DE: path to German model (.onnx)
app.post('/api/tts', (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const langIn = String(req.body?.lang || 'en').toLowerCase();
    const lang = (langIn === 'de') ? 'de' : 'en';
    if (!text) return res.status(400).json({ error: 'text_required' });
    const bin = process.env.PIPER_BIN || '';
    const model = lang === 'de' ? (process.env.PIPER_MODEL_DE || '') : (process.env.PIPER_MODEL_EN || '');
    if (!bin || !model) return res.status(503).json({ error: 'tts_not_configured' });

    // Piper usage: piper --model <model> --output_file -
    const args = ['--model', model, '--output_file', '-'];
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let headersSent = false;
    const send500 = (msg) => {
      try {
        if (!headersSent) {
          res.status(500).json({ error: msg || 'tts_failed' });
        } else {
          res.end();
        }
      } catch {}
    };

    child.on('error', (err) => {
      send500(err?.message || 'spawn_error');
    });

    child.stderr.on('data', (chunk) => {
      // Optional: log Piper stderr for debugging
      // console.warn('piper stderr:', chunk.toString());
    });

    child.stdout.once('data', () => {
      // First audio bytes -> set header
      if (!headersSent) {
        res.setHeader('Content-Type', 'audio/wav');
        headersSent = true;
      }
    });

    child.stdout.pipe(res);

    child.on('close', (code) => {
      if (!headersSent && code !== 0) {
        send500('piper_exit_' + code);
      }
    });

    // Feed text to Piper
    child.stdin.write(text + '\n');
    child.stdin.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Serve static files (frontend) from project root
app.use(express.static(__dirname));

// GET /api/admin/decks -> ALL decks for admins only
app.get('/api/admin/decks', (req, res) => {
  try {
    // Check if user is admin
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: 'not_authenticated' });
    
    const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(uid);
    if (!userRow || userRow.is_admin !== 1) {
      return res.status(403).json({ error: 'admin_required' });
    }
    
    // Return ALL decks for admin
    const allDecksStmt = db.prepare('SELECT id, name, created_at, COALESCE(is_public,1) as is_public, owner_user_id FROM decks ORDER BY created_at ASC');
    const rows = allDecksStmt.all();
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Fallback to index.html for root
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BrainSport server listening on http://127.0.0.1:${PORT}`);
});
