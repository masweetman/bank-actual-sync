import { db } from './schema';
import { encrypt, decrypt } from '../utils/crypto';

// Keys whose values are encrypted at rest
const ENCRYPTED_KEYS = new Set([
  'actual_password',
  'totp_secret',
  'teller_cert',
  'teller_key',
]);

interface SettingsRow {
  key: string;
  value: string;
  encrypted: number | bigint;
}

let _get: ReturnType<typeof db.prepare> | null = null;
let _set: ReturnType<typeof db.prepare> | null = null;
let _del: ReturnType<typeof db.prepare> | null = null;
let _all: ReturnType<typeof db.prepare> | null = null;

const stmts = {
  get: () => _get ??= db.prepare('SELECT value, encrypted FROM settings WHERE key = ?'),
  set: () => _set ??= db.prepare(`
    INSERT INTO settings (key, value, encrypted) VALUES ($key, $value, $encrypted)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted
  `),
  del: () => _del ??= db.prepare('DELETE FROM settings WHERE key = ?'),
  all: () => _all ??= db.prepare('SELECT key, value, encrypted FROM settings'),
};

export const settingsRepo = {
  get(key: string): string | null {
    const row = stmts.get().get(key) as SettingsRow | undefined;
    if (!row) return null;
    try {
      return Number(row.encrypted) === 1 ? decrypt(row.value) : row.value;
    } catch {
      return null; // decryption failed (key changed, etc.)
    }
  },

  set(key: string, value: string): void {
    const shouldEncrypt = ENCRYPTED_KEYS.has(key);
    stmts.set().run({
      $key: key,
      $value: shouldEncrypt ? encrypt(value) : value,
      $encrypted: shouldEncrypt ? 1 : 0,
    });
  },

  delete(key: string): void {
    stmts.del().run(key);
  },

  /** Returns all settings decrypted. Passwords and private keys are never included. */
  getPublic(): Record<string, string> {
    const SKIP = new Set(['actual_password', 'totp_secret', 'admin_password_hash', 'jwt_secret', 'teller_cert', 'teller_key']);
    const rows = stmts.all().all() as unknown as SettingsRow[];
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (SKIP.has(row.key)) continue;
      out[row.key] = row.value;
    }
    return out;
  },

  /** Returns true if a value exists and is non-empty */
  has(key: string): boolean {
    const row = stmts.get().get(key) as SettingsRow | undefined;
    return !!row?.value;
  },
};
