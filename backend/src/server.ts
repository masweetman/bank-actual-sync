import dotenv from 'dotenv';
import path from 'path';
import { randomBytes } from 'crypto';
import { writeFileSync, existsSync, readFileSync } from 'fs';

// ─── Bootstrap ENCRYPTION_KEY ─────────────────────────────────────────────────
// Load .env first, then auto-generate ENCRYPTION_KEY if missing.
const ENV_PATH = path.resolve(__dirname, '../../.env');
dotenv.config({ path: ENV_PATH, override: true });

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  const key = randomBytes(32).toString('hex');
  process.env.ENCRYPTION_KEY = key;
  const line = `\nENCRYPTION_KEY=${key}\n`;
  if (existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, readFileSync(ENV_PATH, 'utf8') + line);
  } else {
    writeFileSync(ENV_PATH, line.trimStart());
  }
  console.log('[server] Generated ENCRYPTION_KEY and saved to .env');
}
import express from 'express';
import http from 'http';
import { Server as SocketIoServer } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { initDb } from './db/schema';
import apiRouter from './api/routes';
import { plaidRepository } from './db/plaidRepository';
import { repository } from './db/repository';
import { getJwtSecret } from './api/auth.middleware';
import bcrypt from 'bcrypt';
import { settingsRepo } from './db/settingsRepository';
import { runPlaidSync } from './jobs/syncJob';
import { startScheduler } from './jobs/scheduler';

// ─── Setup ────────────────────────────────────────────────────────────────────

// Prevent the Actual Budget API's internal async errors from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection (non-fatal):', reason);
});

initDb();

// ─── Seed default password ────────────────────────────────────────────────────
// If no admin password has been set yet, seed "password" so Docker deployments
// have a known credential on first boot. Change it immediately after login.
if (!settingsRepo.has('admin_password_hash')) {
  (async () => {
    const hash = await bcrypt.hash('password', 12);
    settingsRepo.set('admin_password_hash', hash);
    console.log('[server] Default admin password seeded. Change it immediately after first login.');
  })();
}

startScheduler();

const app  = express();
const httpServer = http.createServer(app);
const PORT = parseInt(process.env.BACKEND_PORT ?? '3001', 10);

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? false
    : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json());

// ─── REST Routes ──────────────────────────────────────────────────────────────

app.use('/api', apiRouter);

// ─── Socket.io ────────────────────────────────────────────────────────────────

const io = new SocketIoServer(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  },
});

// JWT auth for Socket.io connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { stage?: string };
    if (payload.stage !== 'authenticated') return next(new Error('Not fully authenticated'));
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// ─── Sync State ───────────────────────────────────────────────────────────────

let syncInProgress = false;

// ─── Socket.io Event Handlers ─────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);

  socket.on('trigger_sync', async () => {
    if (syncInProgress) {
      socket.emit('sync_event', {
        type: 'SYNC_ERROR',
        payload: { message: 'A sync is already in progress' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    syncInProgress = true;

    socket.emit('sync_event', {
      type: 'SYNC_STARTED',
      payload: {},
      timestamp: new Date().toISOString(),
    });

    try {
      const { totalAdded, errors } = await runPlaidSync();
      const staged = repository.listStaged();

      socket.emit('sync_event', {
        type: 'TRANSACTIONS_FETCHED',
        payload: { count: totalAdded, staged: staged.length, errors },
        timestamp: new Date().toISOString(),
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[sync] fatal error:', err);
      socket.emit('sync_event', {
        type: 'SYNC_ERROR',
        payload: { message },
        timestamp: new Date().toISOString(),
      });
    } finally {
      syncInProgress = false;
    }
  });

  socket.on('disconnect', () => {
    console.log(`[ws] client disconnected: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Backend listening on http://0.0.0.0:${PORT}`);
});
