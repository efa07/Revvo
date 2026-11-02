import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"; // ISO-8601 UTC, sorts as text

// Append-only list. The index+1 is stored in PRAGMA user_version. Never edit an applied entry.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','staff')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  -- Money is stored as integer minor units (1 ETB = 100 santim). No floats.
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('drinks','snacks','sweets')),
    size_label TEXT NOT NULL DEFAULT '',
    price_minor INTEGER NOT NULL CHECK (price_minor > 0),
    list_price_minor INTEGER CHECK (list_price_minor IS NULL OR list_price_minor >= price_minor),
    image_url TEXT,
    slot TEXT,                         -- machine channel; used by the real dispenser adapter later
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );

  -- quantity = physically in the machine. reserved = held for open orders.
  -- available = quantity - reserved. quantity only drops after confirmed dispense.
  CREATE TABLE stock (
    product_id INTEGER PRIMARY KEY REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    CHECK (reserved <= quantity)
  );

  CREATE TABLE promo_codes (
    code TEXT PRIMARY KEY,
    amount_off_minor INTEGER,
    percent_off INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    CHECK ((amount_off_minor IS NULL) <> (percent_off IS NULL))
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    machine_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    subtotal_minor INTEGER NOT NULL,
    offer_savings_minor INTEGER NOT NULL,
    promo_code TEXT,
    promo_discount_minor INTEGER NOT NULL DEFAULT 0,
    total_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    -- Payment and dispensing are tracked independently.
    payment_status TEXT NOT NULL DEFAULT 'UNPAID'
      CHECK (payment_status IN ('UNPAID','PENDING','PAID','FAILED','CANCELLED','UNKNOWN')),
    dispense_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
      CHECK (dispense_status IN ('NOT_STARTED','DISPENSING','DELIVERED','PARTIAL','FAILED','UNKNOWN')),
    closed INTEGER NOT NULL DEFAULT 0,       -- customer cancelled; no more payment attempts
    needs_review INTEGER NOT NULL DEFAULT 0, -- paid but not fully delivered; an operator must resolve
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW},
    UNIQUE (user_id, idempotency_key)
  );

  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,                      -- snapshots: later catalog edits never change a past order
    size_label TEXT NOT NULL,
    unit_price_minor INTEGER NOT NULL,
    list_price_minor INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 5),
    reserved_qty INTEGER NOT NULL DEFAULT 0, -- units still held in stock.reserved for this line
    delivered_qty INTEGER NOT NULL DEFAULT 0,
    failed_qty INTEGER NOT NULL DEFAULT 0,   -- definite non-delivery
    unknown_qty INTEGER NOT NULL DEFAULT 0   -- command sent, outcome not proven. NEVER retried automatically
  );

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    provider TEXT NOT NULL,
    provider_txn_id TEXT NOT NULL UNIQUE,    -- our transaction id sent to the provider; one per attempt
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN')),
    checkout_url TEXT,
    raw_status TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE payment_events (               -- dedupe + forensic trail of provider notifications
    id INTEGER PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    txn_id TEXT,
    payload TEXT,
    received_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO settings(key, value) VALUES ('machine_status', 'ACTIVE');

  CREATE INDEX idx_orders_user ON orders(user_id, id DESC);
  CREATE INDEX idx_payments_order ON payments(order_id, id DESC);
  CREATE INDEX idx_payments_open ON payments(status);
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const current = db.pragma('user_version', { simple: true });
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

export const getSetting = (db, key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
export const setSetting = (db, key, value) =>
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
export const audit = (db, actor, action, target, detail) =>
  db.prepare('INSERT INTO audit_log(actor,action,target,detail) VALUES (?,?,?,?)')
    .run(String(actor), action, target == null ? null : String(target), detail ? JSON.stringify(detail) : null);
