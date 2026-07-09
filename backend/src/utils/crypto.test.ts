import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../utils/crypto';

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext string', () => {
    const plain = 'hello-secret-value';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const c1 = encrypt('same-input');
    const c2 = encrypt('same-input');
    expect(c1).not.toBe(c2);
  });

  it('stores ciphertext in iv:tag:data format', () => {
    const ct = encrypt('test');
    expect(ct.split(':')).toHaveLength(3);
  });

  it('throws when ciphertext data is tampered', () => {
    const ct = encrypt('sensitive-data');
    const parts = ct.split(':');
    // Flip the last character of the data segment to corrupt it
    parts[2] = parts[2].slice(0, -4) + 'ZZZZ';
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws when the IV is tampered', () => {
    const ct = encrypt('data');
    const parts = ct.split(':');
    parts[0] = parts[0].slice(0, -2) + 'ZZ';
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws when ENCRYPTION_KEY has the wrong length', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be a 64-char hex string');
    process.env.ENCRYPTION_KEY = saved;
  });

  it('throws when ciphertext has wrong number of segments', () => {
    expect(() => decrypt('not-valid-format')).toThrow('Invalid ciphertext format');
  });

  it('handles empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('handles unicode characters', () => {
    const plain = 'password: 日本語 🔑';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });
});
