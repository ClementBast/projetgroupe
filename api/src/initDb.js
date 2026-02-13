const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'pgpool',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
});

const schema = `
-- ========================================
-- VendreFacile – Schéma de base distribuée
-- PostgreSQL avec réplication streaming
-- ========================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  username      VARCHAR(100) UNIQUE NOT NULL,
  phone         VARCHAR(20),
  city          VARCHAR(100),
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  role          VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user','pro','admin')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(100) UNIQUE NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS annonces (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  price       NUMERIC(12,2),
  city        VARCHAR(100),
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','sold','archived')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS annonce_images (
  id         SERIAL PRIMARY KEY,
  annonce_id INTEGER NOT NULL REFERENCES annonces(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  position   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favorites (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  annonce_id INTEGER NOT NULL REFERENCES annonces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, annonce_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id          SERIAL PRIMARY KEY,
  annonce_id  INTEGER NOT NULL REFERENCES annonces(id) ON DELETE CASCADE,
  buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(annonce_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  read            BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour la recherche / performance
CREATE INDEX IF NOT EXISTS idx_annonces_category ON annonces(category_id);
CREATE INDEX IF NOT EXISTS idx_annonces_city     ON annonces(city);
CREATE INDEX IF NOT EXISTS idx_annonces_price    ON annonces(price);
CREATE INDEX IF NOT EXISTS idx_annonces_status   ON annonces(status);
CREATE INDEX IF NOT EXISTS idx_annonces_user     ON annonces(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv     ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user    ON favorites(user_id);

-- Catégories de base
INSERT INTO categories (name) VALUES
  ('Véhicules'),('Immobilier'),('Multimédia'),('Maison'),('Loisirs'),
  ('Emploi'),('Services'),('Vêtements'),('Animaux'),('Divers')
ON CONFLICT (name) DO NOTHING;
`;

async function ensureSchema() {
  const client = await pool.connect();
  try {
    console.log('[initDb] Applying schema...');
    await client.query(schema);
    console.log('[initDb] Schema applied successfully.');

    const countUsers = await client.query('SELECT COUNT(*)::int AS c FROM users');
    if (countUsers.rows[0].c === 0) {
      console.log('[initDb] Seeding database (first run)...');

      const sellerPass = await bcrypt.hash('password123', 10);
      const buyerPass = await bcrypt.hash('password123', 10);

      const seller = await client.query(
        `INSERT INTO users (email, password_hash, username, city, role)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        ['seller@vendrefacile.local', sellerPass, 'vendeur_demo', 'Paris', 'user']
      );

      const buyer = await client.query(
        `INSERT INTO users (email, password_hash, username, city, role)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        ['buyer@vendrefacile.local', buyerPass, 'acheteur_demo', 'Lyon', 'user']
      );

      const sellerId = seller.rows[0].id;
      const buyerId = buyer.rows[0].id;

      const catVehicules = await client.query("SELECT id FROM categories WHERE name='Véhicules' LIMIT 1");
      const catMultimedia = await client.query("SELECT id FROM categories WHERE name='Multimédia' LIMIT 1");
      const catMaison = await client.query("SELECT id FROM categories WHERE name='Maison' LIMIT 1");

      const a1 = await client.query(
        `INSERT INTO annonces (title, description, price, city, category_id, user_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        ['iPhone 12 128Go', 'Très bon état, batterie OK, vendu avec câble.', 350, 'Paris', catMultimedia.rows[0]?.id || null, sellerId]
      );

      await client.query(
        `INSERT INTO annonces (title, description, price, city, category_id, user_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        ['Vélo de ville', 'Vélo confortable, révisé récemment.', 120, 'Paris', catVehicules.rows[0]?.id || null, sellerId]
      );

      await client.query(
        `INSERT INTO annonces (title, description, price, city, category_id, user_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        ['Table basse en bois', 'Style scandinave, quelques traces d\'usage.', 60, 'Paris', catMaison.rows[0]?.id || null, sellerId, 'sold']
      );

      await client.query(
        `INSERT INTO favorites (user_id, annonce_id) VALUES ($1,$2)`,
        [buyerId, a1.rows[0].id]
      );

      const conv = await client.query(
        `INSERT INTO conversations (annonce_id, buyer_id, seller_id)
         VALUES ($1,$2,$3) RETURNING id`,
        [a1.rows[0].id, buyerId, sellerId]
      );

      await client.query(
        `INSERT INTO messages (conversation_id, sender_id, content)
         VALUES ($1,$2,$3),($1,$4,$5)`,
        [conv.rows[0].id, buyerId, 'Bonjour, toujours disponible ?', sellerId, 'Oui, disponible. Vous souhaitez venir le voir quand ?']
      );

      console.log('[initDb] Seed completed.');
    }
  } finally {
    client.release();
  }
  await pool.end();
}

ensureSchema()
  .then(() => { console.log('[initDb] Done.'); process.exit(0); })
  .catch(err => { console.error('[initDb] Error:', err); process.exit(1); });
