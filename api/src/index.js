const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// ── DB pools ────────────────────────────────────────────────
const writePool = new Pool({
  host: process.env.DB_HOST || 'pgpool',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
});

const readPool = new Pool({
  host: process.env.DB_READ_HOST || 'pg-1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
});

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXP = process.env.JWT_EXPIRES_IN || '7d';

// ── Helpers ─────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXP });
}

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Token invalide' }); }
}

// ── AUTH ────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username, phone, city } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const r = await writePool.query(
      `INSERT INTO users (email, password_hash, username, phone, city)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, username, role`,
      [email, hash, username, phone || null, city || null]
    );
    res.status(201).json({ user: r.rows[0], token: signToken(r.rows[0]) });
  } catch (e) {
    res.status(400).json({ error: e.detail || e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await readPool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!r.rows.length) return res.status(401).json({ error: 'Identifiants invalides' });
    const user = r.rows[0];
    if (!await bcrypt.compare(password, user.password_hash))
      return res.status(401).json({ error: 'Identifiants invalides' });
    res.json({ user: { id: user.id, email: user.email, username: user.username, role: user.role }, token: signToken(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PROFIL ──────────────────────────────────────────────────
app.get('/api/profile', auth, async (req, res) => {
  const r = await readPool.query(
    'SELECT id,email,username,phone,city,role,created_at FROM users WHERE id=$1', [req.user.id]);
  res.json(r.rows[0]);
});

app.put('/api/profile', auth, async (req, res) => {
  const { username, phone, city } = req.body;
  const r = await writePool.query(
    `UPDATE users SET username=COALESCE($1,username), phone=COALESCE($2,phone),
     city=COALESCE($3,city), updated_at=NOW() WHERE id=$4
     RETURNING id,email,username,phone,city,role`,
    [username, phone, city, req.user.id]
  );
  res.json(r.rows[0]);
});

// ── CATEGORIES ──────────────────────────────────────────────
app.get('/api/categories', async (_req, res) => {
  const r = await readPool.query('SELECT * FROM categories ORDER BY name');
  res.json(r.rows);
});

// ── ANNONCES CRUD ───────────────────────────────────────────
app.get('/api/annonces', async (req, res) => {
  const { category_id, city, price_min, price_max, q, status, page = 1, limit = 20 } = req.query;
  const conds = [];
  const params = [];
  let i = 1;
  if (!status || status === 'active') {
    conds.push("a.status='active'");
  } else if (status !== 'all') {
    conds.push(`a.status=$${i++}`);
    params.push(status);
  }
  if (category_id) { conds.push(`a.category_id=$${i++}`); params.push(category_id); }
  if (city) { conds.push(`LOWER(a.city) LIKE $${i++}`); params.push(`%${city.toLowerCase()}%`); }
  if (price_min) { conds.push(`a.price >= $${i++}`); params.push(price_min); }
  if (price_max) { conds.push(`a.price <= $${i++}`); params.push(price_max); }
  if (q) { conds.push(`(LOWER(a.title) LIKE $${i} OR LOWER(a.description) LIKE $${i})`); params.push(`%${q.toLowerCase()}%`); i++; }

  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  params.push(parseInt(limit), offset);

  const sql = `
    SELECT a.*, u.username AS seller_name, c.name AS category_name
    FROM annonces a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN categories c ON c.id = a.category_id
    ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
    ORDER BY a.created_at DESC
    LIMIT $${i++} OFFSET $${i++}`;

  const r = await readPool.query(sql, params);
  res.json(r.rows);
});

app.get('/api/annonces/mine', auth, async (req, res) => {
  const r = await readPool.query(
    `SELECT a.*, c.name AS category_name
     FROM annonces a
     LEFT JOIN categories c ON c.id = a.category_id
     WHERE a.user_id=$1
     ORDER BY a.created_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
});

app.get('/api/annonces/:id', async (req, res) => {
  const r = await readPool.query(
    `SELECT a.*, u.username AS seller_name, u.city AS seller_city, c.name AS category_name
     FROM annonces a JOIN users u ON u.id=a.user_id LEFT JOIN categories c ON c.id=a.category_id
     WHERE a.id=$1`, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Annonce introuvable' });
  res.json(r.rows[0]);
});

app.post('/api/annonces', auth, async (req, res) => {
  const { title, description, price, city, latitude, longitude, category_id } = req.body;
  const r = await writePool.query(
    `INSERT INTO annonces (title,description,price,city,latitude,longitude,category_id,user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, description, price, city || null, latitude || null, longitude || null, category_id || null, req.user.id]
  );
  res.status(201).json(r.rows[0]);
});

app.put('/api/annonces/:id', auth, async (req, res) => {
  const { title, description, price, city, latitude, longitude, category_id, status } = req.body;
  const r = await writePool.query(
    `UPDATE annonces SET title=COALESCE($1,title), description=COALESCE($2,description),
     price=COALESCE($3,price), city=COALESCE($4,city), latitude=COALESCE($5,latitude),
     longitude=COALESCE($6,longitude), category_id=COALESCE($7,category_id),
     status=COALESCE($8,status), updated_at=NOW()
     WHERE id=$9 AND user_id=$10 RETURNING *`,
    [title, description, price, city, latitude, longitude, category_id, status, req.params.id, req.user.id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Annonce introuvable ou non autorisé' });
  res.json(r.rows[0]);
});

app.delete('/api/annonces/:id', auth, async (req, res) => {
  const r = await writePool.query('DELETE FROM annonces WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Annonce introuvable ou non autorisé' });
  res.json({ deleted: true });
});

// ── FAVORIS ─────────────────────────────────────────────────
app.get('/api/favorites', auth, async (req, res) => {
  const r = await readPool.query(
    `SELECT f.id, f.created_at, a.id AS annonce_id, a.title, a.price, a.city
     FROM favorites f JOIN annonces a ON a.id=f.annonce_id WHERE f.user_id=$1
     ORDER BY f.created_at DESC`, [req.user.id]);
  res.json(r.rows);
});

app.post('/api/favorites/:annonce_id', auth, async (req, res) => {
  try {
    const r = await writePool.query(
      'INSERT INTO favorites (user_id,annonce_id) VALUES ($1,$2) RETURNING *',
      [req.user.id, req.params.annonce_id]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(409).json({ error: 'Déjà en favoris' }); }
});

app.delete('/api/favorites/:annonce_id', auth, async (req, res) => {
  await writePool.query('DELETE FROM favorites WHERE user_id=$1 AND annonce_id=$2', [req.user.id, req.params.annonce_id]);
  res.json({ deleted: true });
});

// ── MESSAGERIE ──────────────────────────────────────────────
app.get('/api/conversations', auth, async (req, res) => {
  const r = await readPool.query(
    `SELECT cv.*, a.title AS annonce_title,
       CASE WHEN cv.buyer_id=$1 THEN u2.username ELSE u1.username END AS other_user
     FROM conversations cv
     JOIN annonces a ON a.id=cv.annonce_id
     JOIN users u1 ON u1.id=cv.buyer_id
     JOIN users u2 ON u2.id=cv.seller_id
     WHERE cv.buyer_id=$1 OR cv.seller_id=$1
     ORDER BY cv.created_at DESC`, [req.user.id]);
  res.json(r.rows);
});

app.post('/api/conversations', auth, async (req, res) => {
  const { annonce_id } = req.body;
  const a = await readPool.query('SELECT user_id FROM annonces WHERE id=$1', [annonce_id]);
  if (!a.rows.length) return res.status(404).json({ error: 'Annonce introuvable' });
  if (a.rows[0].user_id === req.user.id) return res.status(400).json({ error: 'Impossible de se contacter soi-même' });
  try {
    const r = await writePool.query(
      'INSERT INTO conversations (annonce_id,buyer_id,seller_id) VALUES ($1,$2,$3) RETURNING *',
      [annonce_id, req.user.id, a.rows[0].user_id]);
    res.status(201).json(r.rows[0]);
  } catch {
    const existing = await readPool.query(
      'SELECT * FROM conversations WHERE annonce_id=$1 AND buyer_id=$2', [annonce_id, req.user.id]);
    res.json(existing.rows[0]);
  }
});

app.get('/api/conversations/:id/messages', auth, async (req, res) => {
  const cv = await readPool.query(
    'SELECT * FROM conversations WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
    [req.params.id, req.user.id]);
  if (!cv.rows.length) return res.status(403).json({ error: 'Accès refusé' });
  const r = await readPool.query(
    `SELECT m.*, u.username AS sender_name FROM messages m
     JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=$1 ORDER BY m.created_at`,
    [req.params.id]);
  res.json(r.rows);
});

app.post('/api/conversations/:id/messages', auth, async (req, res) => {
  const cv = await readPool.query(
    'SELECT * FROM conversations WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)',
    [req.params.id, req.user.id]);
  if (!cv.rows.length) return res.status(403).json({ error: 'Accès refusé' });
  const r = await writePool.query(
    'INSERT INTO messages (conversation_id,sender_id,content) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, req.user.id, req.body.content]);
  res.status(201).json(r.rows[0]);
});

// ── HEALTH ──────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await readPool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) { res.status(500).json({ status: 'error', db: e.message }); }
});

// ── START ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[VendreFacile API] Running on port ${PORT}`));
