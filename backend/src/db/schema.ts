// node:sqlite is built into Node.js 22.5+ — no native compilation required
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.resolve(__dirname, '../../data');
const dbPath = process.env.DB_PATH ?? path.join(DB_DIR, 'transactions.db');

if (dbPath !== ':memory:' && !fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrent read performance
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id                TEXT PRIMARY KEY,
      bank_account      TEXT NOT NULL,
      actual_account_id TEXT NOT NULL DEFAULT '',
      date              TEXT NOT NULL,
      amount            INTEGER NOT NULL,
      payee             TEXT NOT NULL,
      memo              TEXT NOT NULL DEFAULT '',
      cleared                INTEGER NOT NULL DEFAULT 0,
      pending_transaction_id TEXT DEFAULT NULL,
      status                 TEXT NOT NULL DEFAULT 'staged'
                               CHECK(status IN ('staged', 'synced', 'excluded')),
      fetched_at             TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_bank_account ON transactions(bank_account);

    CREATE TABLE IF NOT EXISTS settings (
      key       TEXT PRIMARY KEY,
      value     TEXT NOT NULL DEFAULT '',
      encrypted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS plaid_items (
      id               TEXT PRIMARY KEY,
      item_id          TEXT NOT NULL UNIQUE,
      institution_id   TEXT NOT NULL DEFAULT '',
      institution_name TEXT NOT NULL DEFAULT '',
      access_token     TEXT NOT NULL,
      cursor           TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id                    TEXT PRIMARY KEY,
      name                  TEXT NOT NULL,
      plaid_item_id         TEXT REFERENCES plaid_items(id) ON DELETE CASCADE,
      plaid_account_id      TEXT,
      actual_id             TEXT NOT NULL DEFAULT '',
      actual_server_url     TEXT NOT NULL DEFAULT '',
      actual_sync_id        TEXT NOT NULL DEFAULT '',
      actual_password       TEXT NOT NULL DEFAULT '',
      provider              TEXT NOT NULL DEFAULT 'plaid',
      teller_enrollment_id  TEXT REFERENCES teller_enrollments(id) ON DELETE CASCADE,
      teller_account_id     TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teller_enrollments (
      id               TEXT PRIMARY KEY,
      enrollment_id    TEXT NOT NULL UNIQUE,
      institution_name TEXT NOT NULL DEFAULT '',
      access_token     TEXT NOT NULL,
      last_synced_at   TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: add actual_account_id to transactions if it doesn't exist yet
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN actual_account_id TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — normal on fresh DBs created with the new schema
  }

  // Migration: add pending_transaction_id column if it doesn't exist yet
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN pending_transaction_id TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — normal on fresh DBs created with the new schema
  }

  // Migration: rename scraped_at → fetched_at if the old column exists
  const txCols = (db.prepare(`PRAGMA table_info(transactions)`).all() as { name: string }[]).map(r => r.name);
  if (txCols.includes('scraped_at')) {
    db.exec(`ALTER TABLE transactions RENAME COLUMN scraped_at TO fetched_at`);
  }

  // Migration: drop old scraper columns from accounts if they exist
  const cols = (db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]).map(r => r.name);
  if (cols.includes('bank')) {
    // Recreate accounts table without old scraper columns
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts_new (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        plaid_item_id     TEXT NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
        plaid_account_id  TEXT NOT NULL,
        actual_id         TEXT NOT NULL,
        actual_server_url TEXT NOT NULL DEFAULT '',
        actual_sync_id    TEXT NOT NULL DEFAULT '',
        actual_password   TEXT NOT NULL DEFAULT '',
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );
      DROP TABLE accounts;
      ALTER TABLE accounts_new RENAME TO accounts;
    `);
  }

  // Migration: add Actual Budget credential columns to accounts if they don't exist yet
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN actual_server_url TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN actual_sync_id TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN actual_password TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }

  // Migration: add Teller provider columns to accounts if they don't exist yet
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'plaid'`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN teller_enrollment_id TEXT REFERENCES teller_enrollments(id) ON DELETE CASCADE`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN teller_account_id TEXT`);
  } catch { /* column already exists */ }

  // Migration: make plaid_item_id and plaid_account_id nullable for Teller accounts
  // SQLite doesn't support dropping NOT NULL, so we recreate the table only if still strict.
  const acctColsCheck = (db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string; notnull: number }[]);
  const plaidItemCol = acctColsCheck.find(c => c.name === 'plaid_item_id');
  if (plaidItemCol && plaidItemCol.notnull === 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts_nullable (
        id                    TEXT PRIMARY KEY,
        name                  TEXT NOT NULL,
        plaid_item_id         TEXT REFERENCES plaid_items(id) ON DELETE CASCADE,
        plaid_account_id      TEXT,
        actual_id             TEXT NOT NULL DEFAULT '',
        actual_server_url     TEXT NOT NULL DEFAULT '',
        actual_sync_id        TEXT NOT NULL DEFAULT '',
        actual_password       TEXT NOT NULL DEFAULT '',
        provider              TEXT NOT NULL DEFAULT 'plaid',
        teller_enrollment_id  TEXT REFERENCES teller_enrollments(id) ON DELETE CASCADE,
        teller_account_id     TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO accounts_nullable SELECT id, name, plaid_item_id, plaid_account_id, actual_id, actual_server_url, actual_sync_id, actual_password, COALESCE(provider,'plaid'), teller_enrollment_id, teller_account_id, created_at FROM accounts;
      DROP TABLE accounts;
      ALTER TABLE accounts_nullable RENAME TO accounts;
    `);
  }

  // Migration: create teller_enrollments if missing (pre-Teller installs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS teller_enrollments (
      id               TEXT PRIMARY KEY,
      enrollment_id    TEXT NOT NULL UNIQUE,
      institution_name TEXT NOT NULL DEFAULT '',
      access_token     TEXT NOT NULL,
      last_synced_at   TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
