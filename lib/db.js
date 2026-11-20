import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let _sql = null;
export function getSql() {
  if (!DATABASE_URL) {
    const err = new Error('ยังไม่ได้ตั้งค่า DATABASE_URL (ฐานข้อมูล Neon)');
    err.status = 500;
    throw err;
  }
  if (!_sql) _sql = neon(DATABASE_URL);
  return _sql;
}

/** Run a parameterised query: q('SELECT * FROM x WHERE id = $1', [id]) */
export async function q(text, params = []) {
  await ensureSchema();
  return getSql().query(text, params);
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id            SERIAL PRIMARY KEY,
     username      TEXT UNIQUE NOT NULL,
     password_hash TEXT NOT NULL,
     display_name  TEXT NOT NULL,
     role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
     is_active     BOOLEAN NOT NULL DEFAULT TRUE,
     last_login    TIMESTAMPTZ,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id            SERIAL PRIMARY KEY,
     court_name    TEXT NOT NULL,
     meeting_date  DATE NOT NULL,
     end_date      DATE,
     start_time    TIME NOT NULL,
     end_time      TIME NOT NULL,
     black_case    TEXT NOT NULL,
     red_case      TEXT NOT NULL DEFAULT '',
     reason        TEXT NOT NULL,
     contact_name  TEXT NOT NULL,
     phone         TEXT NOT NULL,
     ip_address    TEXT NOT NULL,
     status        TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','pending','cancelled')),
     note          TEXT NOT NULL DEFAULT '',
     source        TEXT NOT NULL DEFAULT 'web',
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
   )`,
  // added after v2.0 — multi-day bookings (NULL = single day)
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_date DATE`,
  `CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings (meeting_date, start_time)`,
];

let schemaPromise = null;
export function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      for (const stmt of SCHEMA) await sql.query(stmt);
    })().catch((e) => {
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}
