# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type | Purpose | Auth model | Criticality | Evidence |
|--------|------|---------|------------|-------------|----------|
| Plaid | REST API (via `plaid` SDK) | Fetch linked bank account transactions (cursor-based sync), manage Link tokens, revoke items | API key (`PLAID_CLIENT_ID` + `PLAID_SECRET` in HTTP headers) | High — primary transaction source | `backend/src/clients/plaidClient.ts` |
| Teller | REST API (custom HTTPS client) | Fetch bank account transactions and account lists | Mutual TLS (client cert + key stored encrypted in DB) + OAuth access token per enrollment | Medium — optional secondary source | `backend/src/clients/tellerClient.ts` |
| Actual Budget | Node.js SDK (`@actual-app/api`) | Open budgets, import transactions (cleared/pending), update pending→cleared | Server URL + password (stored encrypted in SQLite settings) | High — final import target | `backend/src/clients/actualClient.ts` |
| SQLite (`node:sqlite`) | Local file database | Persist transactions, settings, Plaid items, accounts, Teller enrollments | None (local filesystem) | High — sole persistent store | `backend/src/db/schema.ts` |
| Socket.io | WebSocket | Real-time sync progress events to connected browser clients | JWT (`stage: 'authenticated'`) verified on connection handshake | Medium — UX only; sync works without it | `backend/src/server.ts` |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| SQLite `data/transactions.db` | Primary data store — transactions, settings, Plaid items, accounts, Teller enrollments | `backend/src/db/*Repository.ts` + `schema.ts` | Single file; `DatabaseSync` is synchronous; no horizontal scaling | `backend/src/db/schema.ts` |
| `data/actual-cache/` (local directory) | Actual Budget SDK local cache (downloaded budget file) | `@actual-app/api` SDK internals | Corrupted or stale cache can prevent budget open; no explicit cache-invalidation logic | `backend/src/clients/actualClient.ts` (`ACTUAL_CACHE` const) |

### 3) Secrets and Credentials Handling

- **Credential sources**:
  - Environment variables (`.env` file): `ENCRYPTION_KEY`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`.
  - SQLite `settings` table (encrypted via AES-256-GCM): `actual_password`, `totp_secret`, `teller_cert`, `teller_key`, `admin_password_hash` (bcrypt), `jwt_secret`.
- **Encryption scheme**: `backend/src/utils/crypto.ts` — AES-256-GCM, 96-bit random IV per encrypt call, authenticated (GCM auth tag), stored as `iv:tag:ciphertext` (base64url). Key from `ENCRYPTION_KEY` env var.
- **`settingsRepo` write**: Any key in `ENCRYPTED_KEYS` (`actual_password`, `totp_secret`, `teller_cert`, `teller_key`) is automatically encrypted before `INSERT/UPDATE`.
- **`settingsRepo.getPublic()`**: Strips `actual_password`, `totp_secret`, `admin_password_hash`, `jwt_secret`, `teller_cert`, `teller_key` — never returns secrets to the API response.
- **Hardcoding checks**: No credentials hardcoded in source files. Plaid credentials read from `process.env`; Actual/Teller credentials read from `settingsRepo.get()`.
- **Rotation notes**: `ENCRYPTION_KEY` rotation requires re-encrypting all settings rows manually (no rotation tooling provided). JWT secret is auto-generated once and stored in SQLite; no rotation mechanism.

### 4) Reliability and Failure Behavior

- **Retry/backoff**: None. Plaid and Teller API calls fail immediately on network error; the error message is recorded in the sync result's `errors` array and the affected item/enrollment is skipped.
- **Timeouts**: No explicit HTTP timeout configured for Plaid (`plaid` SDK uses `axios` defaults) or Teller (`https.Agent` default).
- **Circuit-breaker/fallback**: None. A failed Plaid item does not block other items from syncing (items are iterated in a `for` loop with per-item try/catch).
- **Actual Budget SDK**: Opens the SDK per sync run (`actualApi.init()` + `actualApi.downloadBudget()`); not kept persistently open between syncs.
- **Double-sync guard**: A `syncInProgress` boolean in `backend/src/server.ts` prevents concurrent syncs triggered via the WebSocket `trigger_sync` event. The `POST /api/schedule/run-now` route does not share this guard.

### 5) Observability for Integrations

- **Logging**: `console.log` / `console.error` with `[syncJob]`, `[syncJob/teller]`, `[scheduler]`, `[plaid]`, `[teller]` prefixes wrapping all external calls.
- **Metrics/tracing**: None configured (no APM, Prometheus, OpenTelemetry).
- **Scheduler result**: Last run timestamp (`schedule_last_run`) and result string (`schedule_last_result`) are written to the `settings` table and exposed via `GET /api/settings`.
- **Missing visibility gaps**: No structured error reporting; no alerting; no request-level tracing for Plaid/Teller API latency.

### 6) Evidence

- `backend/src/clients/plaidClient.ts` (Plaid integration)
- `backend/src/clients/tellerClient.ts` (Teller mTLS integration)
- `backend/src/clients/actualClient.ts` (Actual Budget SDK integration)
- `backend/src/db/schema.ts` (SQLite table definitions)
- `backend/src/db/settingsRepository.ts` (encrypted settings store)
- `backend/src/utils/crypto.ts` (AES-256-GCM implementation)
- `backend/src/server.ts` (Socket.io JWT auth, `syncInProgress` guard)
- `.env.example` (required credential env vars)
