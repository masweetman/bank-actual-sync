import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Response, NextFunction } from 'express';
import { initDb, db } from '../db/schema';
import { requireAuth, getJwtSecret, type AuthRequest } from '../api/auth.middleware';

beforeAll(() => {
  initDb();
});

// Clear settings before each test so getJwtSecret generates a fresh secret
beforeEach(() => {
  db.exec('DELETE FROM settings');
});

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

// ─── getJwtSecret ─────────────────────────────────────────────────────────────

describe('getJwtSecret', () => {
  it('returns a non-empty string', () => {
    const secret = getJwtSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(32);
  });

  it('returns the same secret on repeated calls within a test (persisted to DB)', () => {
    const s1 = getJwtSecret();
    const s2 = getJwtSecret();
    expect(s1).toBe(s2);
  });
});

// ─── requireAuth ─────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', () => {
    const req = { headers: {} } as AuthRequest;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    requireAuth(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a request with a non-Bearer Authorization header', () => {
    const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    requireAuth(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token with stage="pre-2fa"', () => {
    const secret = getJwtSecret();
    const token = jwt.sign({ sub: 'admin', stage: 'pre-2fa' }, secret);
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    requireAuth(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ sub: 'admin', stage: 'authenticated' }, 'wrong-secret-entirely');
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    requireAuth(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed/non-JWT token string', () => {
    const req = { headers: { authorization: 'Bearer not.a.valid.jwt.string' } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    requireAuth(req, res, next);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid authenticated token and calls next with userId set', () => {
    const secret = getJwtSecret();
    const token = jwt.sign({ sub: 'admin', stage: 'authenticated' }, secret);
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe('admin');
  });

  it('accepts a token without an explicit stage field (legacy tokens)', () => {
    const secret = getJwtSecret();
    const token = jwt.sign({ sub: 'admin' }, secret);
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
