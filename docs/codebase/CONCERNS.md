# Codebase Concerns

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| High | Default admin password `"password"` seeded at first boot | `backend/src/server.ts` lines 49–55 | Deployed containers with unconfigured stacks are immediately compromised | Force password change on first login; remove the default seed or require a custom password via env var |
| High | Raw `err.message` returned to API clients | `backend/src/api/routes.ts` (multiple catch blocks) | Internal error details (file paths, SDK internals, DB messages) leak to the browser | Map errors to safe user-facing messages at the route layer; log details server-side only |
| Medium | No rate limiting on auth endpoints | `backend/src/api/routes.ts` — `POST /auth/login`, `POST /auth/verify-2fa` | Brute-force password or TOTP code attacks are unrestricted | Add `express-rate-limit` to `/auth/*` routes |
| Medium | No CI/CD pipeline | No `.github/workflows/`, no other CI config found | Broken builds and regressions are not caught before merge; Docker images built manually | Add GitHub Actions workflow: lint → build → test |
| Medium | `POST /api/schedule/run-now` not guarded by `syncInProgress` | `backend/src/server.ts` vs `backend/src/api/routes.ts` | Rapid API calls can launch concurrent Actual Budget SDK sessions, potentially corrupting the cache | Share the `syncInProgress` flag with the REST route, or serialize via a queue |
| Low | No request timeout on Plaid / Teller HTTP calls | `backend/src/clients/plaidClient.ts`, `tellerClient.ts` | A hanging external request blocks the sync forever (no cancellation) | Set explicit timeout on Plaid `axios` config; set `timeout` on Teller `https.Agent` |
| Low | Teller Plaid client is a lazy singleton; no reset if `PLAID_ENV` changes | `backend/src/clients/plaidClient.ts` | Changing `PLAID_ENV` in `.env` requires a full process restart — not obvious | Document this constraint or detect env change and rebuild |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| `(actualApi as any).getTransactions` and `(actualApi as any).updateTransaction` | `@actual-app/api` does not export these methods in its public type declarations; they exist at runtime | `backend/src/clients/actualClient.ts` | Breaks silently on any `@actual-app/api` upgrade that changes internal method names | Open an issue upstream to expose these methods; or pin the SDK version tightly until types are available |
| SQLite `initDb()` runs inline `ALTER TABLE` migrations on every startup | Schema was evolved iteratively without a migration framework | `backend/src/db/schema.ts` | Migrations accumulate and slow startup; a failed migration leaves the DB partially upgraded | Adopt a lightweight migration tool (e.g., `better-sqlite3-migrations` or sequential numbered SQL files) |
| No `BACKEND_PORT` validation | Port is parsed with `parseInt` but not range-checked | `backend/src/server.ts` | Non-numeric value silently becomes `NaN`, causing `listen()` to fail with a confusing error | Validate the port at startup |
| CORS set to `origin: false` in production | Correct for reverse-proxy deployment, but may surprise developers testing without a proxy | `backend/src/server.ts` | Frontend dev builds cannot reach the backend if `NODE_ENV=production` is set locally | Document explicitly; consider a `CORS_ORIGIN` env var override |

### 3) Security Concerns

| Risk | OWASP category | Evidence | Current mitigation | Gap |
|------|---------------|----------|--------------------|-----|
| Default admin password `"password"` at first boot | A07 — Identification and Authentication Failures | `backend/src/server.ts` | None — seeded unconditionally if no password hash exists | Force immediate change; add a first-run wizard that blocks use until a custom password is set |
| Raw internal error messages returned to clients | A05 — Security Misconfiguration | `backend/src/api/routes.ts` catch blocks | None | Map to generic user messages; log details only |
| No rate limiting on login/2FA endpoints | A07 — Identification and Authentication Failures | `backend/src/api/routes.ts` | bcrypt cost factor slows individual attempts | Add `express-rate-limit` |
| JWT secret stored in SQLite (same DB as app data) | A02 — Cryptographic Failures | `backend/src/api/auth.middleware.ts` `getJwtSecret()` | Secret is randomly generated and not logged | Compromising the DB also compromises the JWT secret; consider storing in env var |
| No HTTPS enforcement in the backend itself | A05 — Security Misconfiguration | `backend/src/server.ts` | Intended to be TLS-terminated by Nginx Proxy Manager per README | If deployed without a reverse proxy, traffic is unencrypted; should be documented as a hard requirement |
| Teller mTLS certs stored as plaintext PEM in SQLite (encrypted at rest) | A02 — Cryptographic Failures | `backend/src/db/settingsRepository.ts` | AES-256-GCM encryption at rest via `ENCRYPTION_KEY` | If `ENCRYPTION_KEY` is compromised, certs and private key are exposed; no HSM or secrets-manager integration |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| `DatabaseSync` is synchronous | `backend/src/db/schema.ts` `new DatabaseSync(...)` | Blocks the event loop on every DB call | Single-node only; cannot scale horizontally with file-based SQLite | Acceptable for current single-user deployment; revisit if multi-user or higher throughput is needed |
| Actual Budget SDK serializes per `syncId` | `backend/src/clients/actualClient.ts` | Each budget group is opened sequentially | With many budgets, import time grows linearly | Acceptable for personal use; parallelization blocked by SDK's single-budget-open model |
| `upsertMany` iterates transactions one-by-one | `backend/src/db/repository.ts` | N individual `run()` calls per sync batch | Performance degrades with large transaction sets | Wrap in a single `BEGIN`/`COMMIT` transaction block |
| No pagination on `GET /api/transactions` | `backend/src/api/routes.ts` | Returns all staged/synced transactions | With years of history, response payload grows unbounded | Add `limit`/`offset` or cursor-based pagination |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal (last 90 days) | Safe change strategy |
|------|-------------|----------------------------|----------------------|
| `backend/src/api/routes.ts` | Central monolithic route file; contains auth, settings, Plaid, Teller, account, transaction logic | 6 commits | Split into domain-specific sub-routers; add tests before refactoring |
| `frontend/src/pages/Settings/Settings.tsx` | Manages all settings UI (Plaid, Teller, Actual, auth, scheduler) in one component | 6 commits | Extract sub-sections into dedicated components; test each independently |
| `frontend/src/services/settingsApi.ts` | Frequently updated as new settings endpoints are added | 6 commits | Co-evolves with `routes.ts`; treat as coupled; version changes together |
| `backend/src/clients/actualClient.ts` | Depends on unofficial `@actual-app/api` internals (`as any` casts) | 5 commits | Pin SDK version; add a compatibility integration test |
| `backend/src/db/schema.ts` | Accumulates migrations inline; modified whenever schema changes | 2 commits | Replace inline `ALTER TABLE` migrations with a numbered migration system |

### 6) `[ASK USER]` Questions

1. [ASK USER] Is Teller integration considered production-ready or experimental? (Affects how prominently concerns about mTLS cert storage should be documented.)
2. [ASK USER] Is multi-user or multi-instance support a future goal? (Would require replacing SQLite with a server-based DB and redesigning auth.)
3. [ASK USER] Is the default `"password"` seed intentional for all deployments, or is it a development convenience that should be removed before a public release?
4. [ASK USER] Is the `POST /api/schedule/run-now` endpoint intended to be idempotent/concurrent-safe, or should it also respect the `syncInProgress` guard?

### 7) Evidence

- `backend/src/server.ts` (default password seed, `syncInProgress` guard, CORS config)
- `backend/src/api/routes.ts` (error message leakage, no rate limiting, monolithic routes)
- `backend/src/clients/actualClient.ts` (`as any` casts for SDK internals)
- `backend/src/db/schema.ts` (inline ALTER TABLE migrations)
- `backend/src/db/repository.ts` (`upsertMany` loop, no explicit transaction)
- `backend/src/api/auth.middleware.ts` (`getJwtSecret()` — DB-stored JWT secret)
- git churn: `git log --since="90 days ago"` (6 hits each: `routes.ts`, `Settings.tsx`, `settingsApi.ts`)
