# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `backend/` | Node.js/Express API server, SQLite database, all server-side logic | `backend/package.json`, `backend/src/server.ts` |
| `frontend/` | React SPA, Vite build, served by Nginx in Docker | `frontend/package.json`, `frontend/Dockerfile` |
| `docker-compose.yml` | Multi-service container stack (`sync-backend` + `sync-ui`), external `budget-net` network | `docker-compose.yml` |
| `package.json` | Root monorepo config (npm workspaces, `dev`/`build`/`lint` scripts via concurrently) | `package.json` |
| `.env.example` | Documents required environment variables | `.env.example` |
| `README.md` | Deployment guide (Docker + Portainer workflow) | `README.md` |

### 2) Entry Points

- **Backend runtime entry**: `backend/src/server.ts` — loads `.env`, auto-generates `ENCRYPTION_KEY`, initialises SQLite, seeds default password, starts scheduler, creates Express app + Socket.io server.
- **Frontend runtime entry**: `frontend/src/main.tsx` — renders `<App />` into `#root`.
- **Dev entry selection**: `npm run dev` (root) launches both via `concurrently`; each workspace's `dev` script starts its own server.
- **Production backend start**: `node dist/server.js` (compiled output in `backend/dist/`).
- **Production frontend**: Static files built to `frontend/dist/` and served by Nginx.

### 3) Module Boundaries (Backend)

| Module | What belongs here | What must not be here |
|--------|-------------------|-----------------------|
| `backend/src/api/` | Express route handlers, request validation, JWT auth middleware | Business logic, direct DB access |
| `backend/src/clients/` | Wrappers for Plaid SDK, Actual Budget SDK, Teller mTLS REST | Route handling, DB queries |
| `backend/src/db/` | SQLite schema init (`schema.ts`), repository classes (typed data-access functions) | HTTP logic, external API calls |
| `backend/src/jobs/` | Sync orchestration (`syncJob.ts`), cron scheduler (`scheduler.ts`) | Route definition, direct DB schema changes |
| `backend/src/types/` | Shared TypeScript interfaces and type aliases | Runtime logic |
| `backend/src/utils/` | AES-256-GCM encrypt/decrypt helpers | Application-level concerns |

### 4) Module Boundaries (Frontend)

| Module | What belongs here | What must not be here |
|--------|-------------------|-----------------------|
| `frontend/src/pages/` | Top-level page components (`Dashboard`, `Settings`) | Reusable UI atoms |
| `frontend/src/components/` | Reusable UI components (`LoginGate`, `SyncStatus`, `TransactionTable`, etc.) | Page-specific business logic |
| `frontend/src/hooks/` | React hooks: `useAuth`, `useSocket`, `useTransactions` | Direct API calls without abstraction |
| `frontend/src/services/` | `fetch`-based API clients (`api.ts`, `settingsApi.ts`) | React state management |
| `frontend/src/types/` | Frontend TypeScript interfaces | Runtime logic |
| `frontend/src/utils/` | Pure utility functions (`formatCurrency`) | Side effects |

### 5) Naming and Organization Rules

- **Backend file naming**: camelCase (e.g., `syncJob.ts`, `plaidClient.ts`, `accountRepository.ts`, `auth.middleware.ts`).
- **Frontend file naming**: PascalCase for React component files and their folders (e.g., `Dashboard.tsx`, `TransactionTable.tsx`, `LinkToActualModal/`); camelCase for hooks and services (e.g., `useAuth.tsx`, `api.ts`).
- **Frontend component folders**: each component lives in its own subdirectory with the same PascalCase name, optionally containing `index.ts`, a `.module.css` file, and the component `.tsx` file.
- **Directory organization**: backend is **layer-based** (`api/`, `clients/`, `db/`, `jobs/`, `types/`, `utils/`); frontend is **layer-based** (`pages/`, `components/`, `hooks/`, `services/`, `types/`, `utils/`).
- **Import aliasing**: no path aliases configured in either `tsconfig.json`; all imports use relative paths.
- **Barrel exports**: used in some frontend component folders (`index.ts` re-exports); not used in backend.

### 6) Evidence

- `backend/src/server.ts` (backend entry point, initialization order)
- `frontend/src/main.tsx` (frontend entry point)
- `backend/tsconfig.json` (module resolution, `rootDir`, `outDir`)
- `frontend/vite.config.ts` (Vite build config)
- `docs/codebase/.codebase-scan.txt` (full directory tree)
