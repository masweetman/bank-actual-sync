import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { settingsRepo } from '../db/settingsRepository';

export interface AuthRequest extends Request {
  userId?: string;
}

/** Returns (and creates on first use) the JWT signing secret stored in the DB. */
export function getJwtSecret(): string {
  let secret = settingsRepo.get('jwt_secret');
  if (!secret) {
    secret = randomBytes(48).toString('hex');
    settingsRepo.set('jwt_secret', secret);
  }
  return secret;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret) as { sub: string; stage?: string };
    if (payload.stage === 'pre-2fa') {
      res.status(401).json({ error: 'Two-factor authentication required' });
      return;
    }
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

