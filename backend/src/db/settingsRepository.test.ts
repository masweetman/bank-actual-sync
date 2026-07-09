import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, db } from '../db/schema';
import { settingsRepo } from '../db/settingsRepository';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.exec('DELETE FROM settings');
});

describe('set / get', () => {
  it('stores and retrieves a plain-text value', () => {
    settingsRepo.set('actual_server_url', 'http://localhost:5006');
    expect(settingsRepo.get('actual_server_url')).toBe('http://localhost:5006');
  });

  it('returns null for a missing key', () => {
    expect(settingsRepo.get('nonexistent_key')).toBeNull();
  });

  it('overwrites an existing key with a new value', () => {
    settingsRepo.set('schedule_cron', '0 * * * *');
    settingsRepo.set('schedule_cron', '0 0 * * *');
    expect(settingsRepo.get('schedule_cron')).toBe('0 0 * * *');
  });

  it('encrypts actual_password at rest', () => {
    settingsRepo.set('actual_password', 'my-secret-pw');
    const row = db.prepare('SELECT value, encrypted FROM settings WHERE key = ?').get('actual_password') as {
      value: string;
      encrypted: number;
    };
    expect(row.encrypted).toBe(1);
    expect(row.value).not.toBe('my-secret-pw');
  });

  it('decrypts actual_password transparently on get', () => {
    settingsRepo.set('actual_password', 'my-secret-pw');
    expect(settingsRepo.get('actual_password')).toBe('my-secret-pw');
  });

  it('encrypts totp_secret at rest', () => {
    settingsRepo.set('totp_secret', 'TOTP_BASE32_SECRET');
    const row = db.prepare('SELECT encrypted FROM settings WHERE key = ?').get('totp_secret') as { encrypted: number };
    expect(row.encrypted).toBe(1);
  });

  it('encrypts teller_cert at rest', () => {
    settingsRepo.set('teller_cert', '-----BEGIN CERTIFICATE-----');
    const row = db.prepare('SELECT encrypted FROM settings WHERE key = ?').get('teller_cert') as { encrypted: number };
    expect(row.encrypted).toBe(1);
  });

  it('encrypts teller_key at rest', () => {
    settingsRepo.set('teller_key', '-----BEGIN PRIVATE KEY-----');
    const row = db.prepare('SELECT encrypted FROM settings WHERE key = ?').get('teller_key') as { encrypted: number };
    expect(row.encrypted).toBe(1);
  });

  it('stores non-sensitive keys as plain text', () => {
    settingsRepo.set('schedule_enabled', 'true');
    const row = db.prepare('SELECT encrypted FROM settings WHERE key = ?').get('schedule_enabled') as { encrypted: number };
    expect(row.encrypted).toBe(0);
  });
});

describe('has', () => {
  it('returns true when a key exists with a non-empty value', () => {
    settingsRepo.set('schedule_enabled', 'true');
    expect(settingsRepo.has('schedule_enabled')).toBe(true);
  });

  it('returns false when a key does not exist', () => {
    expect(settingsRepo.has('missing_key')).toBe(false);
  });
});

describe('delete', () => {
  it('removes a key', () => {
    settingsRepo.set('schedule_enabled', 'true');
    settingsRepo.delete('schedule_enabled');
    expect(settingsRepo.has('schedule_enabled')).toBe(false);
    expect(settingsRepo.get('schedule_enabled')).toBeNull();
  });

  it('is a no-op for a missing key', () => {
    expect(() => settingsRepo.delete('never-existed')).not.toThrow();
  });
});

describe('getPublic', () => {
  it('includes non-secret settings', () => {
    settingsRepo.set('actual_server_url', 'http://example.com');
    settingsRepo.set('schedule_cron', '0 * * * *');
    const pub = settingsRepo.getPublic();
    expect(pub['actual_server_url']).toBe('http://example.com');
    expect(pub['schedule_cron']).toBe('0 * * * *');
  });

  it('excludes actual_password', () => {
    settingsRepo.set('actual_password', 'secret');
    expect(settingsRepo.getPublic()['actual_password']).toBeUndefined();
  });

  it('excludes totp_secret', () => {
    settingsRepo.set('totp_secret', 'secret');
    expect(settingsRepo.getPublic()['totp_secret']).toBeUndefined();
  });

  it('excludes admin_password_hash', () => {
    settingsRepo.set('admin_password_hash', '$2b$12$...');
    expect(settingsRepo.getPublic()['admin_password_hash']).toBeUndefined();
  });

  it('excludes jwt_secret', () => {
    settingsRepo.set('jwt_secret', 'random-hex-string');
    expect(settingsRepo.getPublic()['jwt_secret']).toBeUndefined();
  });

  it('excludes teller_cert and teller_key', () => {
    settingsRepo.set('teller_cert', 'cert-pem');
    settingsRepo.set('teller_key', 'key-pem');
    const pub = settingsRepo.getPublic();
    expect(pub['teller_cert']).toBeUndefined();
    expect(pub['teller_key']).toBeUndefined();
  });
});
