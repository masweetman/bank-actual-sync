# Architecture

## Core Sections (Required)

### 1) Architectural Style

- **Primary style**: Layered (API → Client/Job → Repository → Data store) with an event-driven real-time channel for sync progress.
- **Classification rationale**: The backend is organized into explicit horizontal layers — HTTP routing (`api/`), external-service wrappers (`clients/`), background jobs (`jobs/`), and data access (`db/`) — each with a single stated responsibility. The frontend follows the same layered split: pages → components → hooks → services.
- **Primary constraints**:
  1. Single-node, single-admin deployment — no horizontal scaling; SQLite `DatabaseSync` is synchronous and file-local.
  2. Encryption-at-rest requirement — all secrets written to SQLite pass through AES-256-GCM (`utils/crypto.ts`) before persistence.
  3. Actual Budget SDK manages its own local cache (`data/actual-cache/`) and must open one budget at a time; sync operations are serialized.

### 2) System Flow

```text
Browser (React SPA)
  │
  ├─ REST  ──▶  Express (backend/src/server.ts)
  │               └─ JWT auth middleware (api/auth.middleware.ts)
  │                    └─ API Router (api/routes.ts)
  │                         ├─ Plaid client (clients/plaidClient.ts) ──▶ Plaid API
  │                         ├─ Teller client (clients/tellerClient.ts) ──▶ Teller API (mTLS)
  │                         ├─ Actual client (clients/actualClient.ts) ──▶ Actual Budget server
  │                         └─ Repositories (db/) ──▶ SQLite (data/transactions.db)
  │
  └─ WebSocket ──▶  Socket.io server (backend/src/server.ts)
                       └─ Emits sync events (SYNC_STARTED, TRANSACTIONS_FETCHED, SYNC_COMPLETE, SYNC_ERROR)
                            └─ Triggered by: manual "trigger_sync" WS event or cron scheduler (jobs/scheduler.ts)
                                 └─ runFullSync() in jobs/syncJob.ts
                                      ├─ runPlaidSync()  → fetch txns → repository.upsertMany()
                                      ├─ runTellerSync() → fetch txns → repository.upsertMany()
                                      └─ importStagedTransactions() → Actual Budget SDK
```

**Key steps:**
1. User opens the SPA; `useAuth` hook polls `GET /api/auth/status` to determine setup state.
2. After login (password → JWT; optional TOTP → full JWT), all REST calls attach `Authorization: Bearer <token>`.
3. On "Sync" trigger (UI button or cron job), `runFullSync()` fetches new transactions from Plaid (using cursor-based pagination) and Teller (date-range based), upserts them as `staged` into SQLite.
4. Socket.io broadcasts progress events to connected clients in real-time.
5. User reviews staged transactions in the Dashboard; clicks "Sync to Actual" to call `POST /api/schedule/run-now` (or the router calls `importStagedTransactions()` directly).
6. `actualClient.ts` opens the Actual Budget SDK, groups transactions by `actual_sync_id`, imports cleared/pending transactions, and marks them `synced` in SQLite.

### 3) Layer/Module Responsibilities

| Layer | Owns | Must not own | Evidence |
|-------|------|--------------|----------|
| `api/routes.ts` | Route definitions, request validation, HTTP response shaping | Business logic, DB queries, external API calls | `backend/src/api/routes.ts` |
| `api/auth.middleware.ts` | JWT extraction, verification, 2FA stage check | Route-specific logic | `backend/src/api/auth.middleware.ts` |
| `clients/plaidClient.ts` | Plaid SDK instantiation (lazy singleton), link token, exchange, sync | Transaction persistence, HTTP routing | `backend/src/clients/plaidClient.ts` |
| `clients/actualClient.ts` | Actual Budget SDK lifecycle, transaction import, budget grouping | Direct SQLite access, HTTP routing | `backend/src/clients/actualClient.ts` |
| `clients/tellerClient.ts` | Teller mTLS HTTPS agent, account/transaction fetch | Token persistence, routing | `backend/src/clients/tellerClient.ts` |
| `db/schema.ts` | SQLite init, table DDL, run-time migrations | Business logic | `backend/src/db/schema.ts` |
| `db/*Repository.ts` | Typed read/write access to a single table or domain | Cross-table joins that encode business rules | `backend/src/db/repository.ts` etc. |
| `jobs/syncJob.ts` | Orchestrates multi-source fetch + Actual import, returns result structs | Route handling, direct socket emission | `backend/src/jobs/syncJob.ts` |
| `jobs/scheduler.ts` | Cron job lifecycle (start/stop/restart based on settings) | Sync logic | `backend/src/jobs/scheduler.ts` |
| `frontend/hooks/` | React state + side-effect management (auth state machine, socket events, transaction data) | Direct fetch calls | `frontend/src/hooks/useAuth.tsx`, `useSocket.ts` |
| `frontend/services/` | HTTP fetch wrappers (JWT header injection, JSON de/serialization) | React state | `frontend/src/services/api.ts` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Repository | `backend/src/db/*Repository.ts` | Isolates SQLite access behind typed functions; prevents SQL scattered across routes |
| Lazy Singleton | `backend/src/clients/plaidClient.ts` (`_client`), `backend/src/db/repository.ts` (prepared statements) | Defer initialization until first use; avoid startup failures when env vars missing |
| Adapter/Wrapper | `backend/src/clients/` (all three) | Shields the rest of the app from external SDK/API changes |
| State Machine | `frontend/src/hooks/useAuth.tsx` | Models auth lifecycle (loading → setup_required → unauthenticated → awaiting_2fa → authenticated) as explicit discriminated union |
| Encrypted Settings Store | `backend/src/db/settingsRepository.ts` + `utils/crypto.ts` | Secrets (passwords, TOTP key, Teller certs) encrypted transparently on write, decrypted on read |
| Cursor-based Pagination | `backend/src/clients/plaidClient.ts` + `plaidRepository.updateCursor()` | Plaid Transactions Sync API requires a cursor stored per-item for incremental updates |

### 5) Known Architectural Risks

- **Single-user, no multi-tenancy**: auth is a single admin password; no user table exists. Adding multiple users requires a redesign of the auth layer.
- **SQLite as sole data store**: `DatabaseSync` is synchronous and single-file. Concurrent writes from the scheduler and a simultaneous manual sync could contend; only a `syncInProgress` boolean in `server.ts` guards against double sync from the same process. No protection against two processes sharing the same volume.
- **Actual Budget SDK serialization**: `actualApi.downloadBudget()` / `actualApi.init()` open a local budget file. Only one budget can be open at a time per process; the code loops sequentially by `syncId` but does not hold an exclusive lock.
- **No retry/backoff on external APIs**: Plaid and Teller calls fail immediately; a transient network error marks the whole item as errored with no retry.

### 6) Evidence

- `backend/src/server.ts` (entry, middleware stack, Socket.io setup)
- `backend/src/api/routes.ts` (all REST endpoints)
- `backend/src/jobs/syncJob.ts` (full sync orchestration)
- `backend/src/clients/actualClient.ts` (Actual Budget SDK usage)
- `backend/src/db/schema.ts` (SQLite init and migration)
- `frontend/src/hooks/useAuth.tsx` (auth state machine)
