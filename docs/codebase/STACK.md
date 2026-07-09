# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | TypeScript 5.5 | `backend/package.json`, `frontend/package.json` |
| Runtime + version | Node.js ≥ 22 (backend); browser (frontend) | `backend/Dockerfile` (`FROM node:22-slim`), `@actual-app/api` engine `>=20` |
| Package manager | npm (workspaces) | `package.json` `"workspaces": ["backend","frontend"]` |
| Backend module/build | CommonJS via `tsc`; `ts-node-dev` for dev | `backend/tsconfig.json` `"module": "commonjs"` |
| Frontend module/build | ESNext via Vite 5.4 + `@vitejs/plugin-react` | `frontend/vite.config.ts`, `frontend/tsconfig.json` |

### 2) Production Frameworks and Dependencies

**Backend** (`backend/package.json` — `dependencies` only)

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| express | 4.19 | HTTP API server | `backend/src/server.ts` |
| socket.io | 4.8 | Real-time WebSocket sync events | `backend/src/server.ts` |
| jsonwebtoken | 9.0 | JWT issuance and verification | `backend/src/api/auth.middleware.ts` |
| bcrypt | 5.1 | Password hashing (bcrypt, 12 rounds) | `backend/src/api/routes.ts` |
| otplib | 12.0 | TOTP 2FA (HMAC-based authenticator) | `backend/src/api/routes.ts` |
| plaid | 42.2 | Plaid API client (link + transactions) | `backend/src/clients/plaidClient.ts` |
| @actual-app/api | 26.5 | Actual Budget SDK (budget open, import txns) | `backend/src/clients/actualClient.ts` |
| node-cron | 3.0 | Scheduled sync job dispatcher | `backend/src/jobs/scheduler.ts` |
| dotenv | 16.4 | `.env` file loading at startup | `backend/src/server.ts` |
| qrcode | 1.5 | QR code generation for 2FA setup | `backend/src/api/routes.ts` |
| uuid | 10.0 | UUID generation (primary keys) | `backend/src/db/` repositories |
| cors | 2.8 | CORS middleware | `backend/src/server.ts` |

**Frontend** (`frontend/package.json` — `dependencies` only)

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| react + react-dom | 18.3 | UI framework | `frontend/src/App.tsx` |
| react-router-dom | 6.26 | Client-side routing | `frontend/src/App.tsx` |
| socket.io-client | 4.8 | WebSocket connection to backend | `frontend/src/hooks/useSocket.ts` |
| react-plaid-link | 4.1 | Plaid Link embedded flow | `frontend/src/pages/Settings/Settings.tsx` |
| teller-connect-react | 0.2 | Teller Connect embedded flow | `frontend/src/components/TellerConnectButton/TellerConnectButton.tsx` |

**Node.js built-in used in production**

| API | Version constraint | Role | Evidence |
|-----|--------------------|------|----------|
| `node:sqlite` (`DatabaseSync`) | Node.js ≥ 22.5 | Synchronous SQLite (no native compilation) | `backend/src/db/schema.ts` |
| `node:crypto` | built-in | AES-256-GCM encryption/decryption | `backend/src/utils/crypto.ts` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| TypeScript 5.5 | Static typing + compilation | `backend/package.json` devDeps, `frontend/package.json` devDeps |
| ts-node-dev 2.0 | Hot-reload dev server (backend) | `backend/package.json` `"dev": "ts-node-dev ..."` |
| Vite 5.4 | Frontend bundler + dev server | `frontend/vite.config.ts` |
| @vitejs/plugin-react | React Fast Refresh in Vite | `frontend/vite.config.ts` |
| concurrently 8.2 | Run backend + frontend dev servers together | root `package.json` `"dev"` script |
| ESLint (frontend only) | Linting (no config file found in repo root; likely defaults) | `frontend/package.json` `"lint"` script |

### 4) Key Commands

```bash
# Install all workspaces
npm install

# Start dev (backend + frontend concurrently)
npm run dev

# Build all
npm run build

# Lint all
npm run lint

# Backend only
npm run dev --workspace=backend
npm run build --workspace=backend

# Frontend only
npm run dev --workspace=frontend
npm run build --workspace=frontend
```

### 5) Environment and Config

- **Config sources**: `.env` file (loaded by dotenv in `backend/src/server.ts`); application settings stored encrypted in SQLite (`settings` table).
- **Required env vars** (from `.env.example`):
  - `ENCRYPTION_KEY` — 64-char hex, AES-256-GCM key; auto-generated and written to `.env` on first start if absent.
  - `PLAID_CLIENT_ID` — Plaid developer credential.
  - `PLAID_SECRET` — Plaid developer credential.
- **Optional env vars**:
  - `PLAID_ENV` — `production` (default) or `sandbox`.
  - `BACKEND_PORT` — overrides default `3001`.
  - `TELLER_APPLICATION_ID`, `TELLER_ENV` — can also be set via the Settings UI.
- **Deployment constraint**: `node:sqlite` (`DatabaseSync`) requires Node.js ≥ 22.5; Docker image uses `node:22-slim` / `node:22-alpine`.

### 6) Evidence

- `package.json` (root monorepo workspace config)
- `backend/package.json` (backend prod/dev deps)
- `frontend/package.json` (frontend prod/dev deps)
- `backend/tsconfig.json` (backend TS compiler settings)
- `frontend/tsconfig.json` (frontend TS compiler settings)
- `backend/Dockerfile` (Node.js version, build steps)
- `.env.example` (required env var reference)
- `backend/src/db/schema.ts` (`node:sqlite` usage)
- `backend/src/utils/crypto.ts` (`node:crypto` usage)
