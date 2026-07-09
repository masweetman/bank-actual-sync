# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Backend source files | camelCase | `syncJob.ts`, `plaidClient.ts`, `accountRepository.ts` | `backend/src/` directory |
| Backend middleware files | dot-separated qualifier | `auth.middleware.ts` | `backend/src/api/auth.middleware.ts` |
| Frontend component files | PascalCase (matches component name) | `Dashboard.tsx`, `TransactionTable.tsx` | `frontend/src/pages/`, `frontend/src/components/` |
| Frontend component folders | PascalCase | `TransactionTable/`, `LinkToActualModal/` | `frontend/src/components/` |
| Frontend hook files | camelCase with `use` prefix | `useAuth.tsx`, `useSocket.ts` | `frontend/src/hooks/` |
| Frontend service files | camelCase | `api.ts`, `settingsApi.ts` | `frontend/src/services/` |
| Functions and variables | camelCase | `runPlaidSync`, `accessToken`, `syncInProgress` | `backend/src/jobs/syncJob.ts` |
| TypeScript interfaces | PascalCase, no `I` prefix | `Transaction`, `PlaidItem`, `SyncResult` | `backend/src/types/index.ts` |
| TypeScript type aliases | PascalCase | `TransactionStatus`, `AuthState` | `backend/src/types/index.ts`, `frontend/src/hooks/useAuth.tsx` |
| Environment variables | SCREAMING_SNAKE_CASE | `ENCRYPTION_KEY`, `PLAID_CLIENT_ID` | `.env.example` |
| SQLite columns | snake_case | `bank_account`, `fetched_at`, `actual_account_id` | `backend/src/db/schema.ts` |
| Private/internal module state | underscore-prefixed module-level `let` | `_client`, `_get`, `_upsert` (prepared stmt cache) | `backend/src/clients/plaidClient.ts`, `backend/src/db/repository.ts` |

### 2) Formatting and Linting

- **Formatter**: None configured (no `.prettierrc`, `prettier.config.js`, or `.editorconfig` found in the repository).
- **Linter**: ESLint — configured for the **frontend workspace only** via `frontend/package.json` `"lint"` script. No ESLint config file committed; uses `@vitejs/plugin-react` defaults. Backend has no linter configured.
- **Most relevant enforced TypeScript rules** (both workspaces via `tsconfig.json`):
  - `"strict": true` — enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, etc.
  - Frontend additionally: `"noUnusedLocals": true`, `"noUnusedParameters": true`, `"noFallthroughCasesInSwitch": true`.
- **Run commands**:
  ```bash
  npm run lint                    # both workspaces
  npm run lint --workspace=frontend
  ```

### 3) Import and Module Conventions

- **Import order**: No enforced order (no `eslint-plugin-import` or similar); imports are grouped informally as: third-party → internal modules → types.
- **Alias vs relative import**: No TypeScript path aliases configured in either `tsconfig.json`. All imports use relative paths (e.g., `../db/repository`, `./schema`).
- **Barrel exports**: Used in some frontend component folders (`components/LoginGate/index.ts`, `components/SyncStatus/index.ts`, `components/TransactionTable/index.ts`). Not used in the backend.
- **`node:` protocol**: Backend imports Node.js built-ins with the `node:` prefix (e.g., `import { DatabaseSync } from 'node:sqlite'`), consistent with Node.js 22 best practice.

### 4) Error and Logging Conventions

- **Route layer**: Returns structured JSON error objects `{ error: string }` with appropriate HTTP status codes. Raw `Error` messages are sent to the client (e.g., `err.message`) — see CONCERNS.md.
- **Client/job layer**: Functions throw `Error` instances; callers catch and convert to result structs (`{ errors: string[] }`) or HTTP error responses.
- **Repository layer**: Functions throw on unexpected DB errors; no custom error classes exist.
- **Logging style**: `console.log` / `console.warn` / `console.error` with a bracketed module prefix on every log line.
  - Format: `[module] message` — e.g., `[server]`, `[syncJob]`, `[scheduler]`, `[ws]`, `[teller]`, `[plaid]`.
  - No structured logging library; no log levels beyond console methods.
- **Sensitive data**: Secrets (passwords, tokens, TOTP secrets, Teller certs) are never logged. The `settingsRepo.getPublic()` method explicitly skips known secret keys before returning settings to the API.

### 5) Testing Conventions

- **Test framework**: None configured.
- **Test file naming/location**: No test files exist in the repository.
- **Mocking strategy**: [TODO] — no precedent established.
- **Coverage expectation**: [TODO] — no threshold configured.

> See `TESTING.md` for full details.

### 6) Evidence

- `backend/tsconfig.json` (`strict`, target, module settings)
- `frontend/tsconfig.json` (`strict`, `noUnusedLocals`, `noUnusedParameters`)
- `backend/src/types/index.ts` (interface/type naming)
- `backend/src/jobs/syncJob.ts` (function naming, logging style)
- `backend/src/db/repository.ts` (private statement cache naming convention)
- `frontend/src/hooks/useAuth.tsx` (hook naming, type alias naming)
- `frontend/src/components/LoginGate/index.ts` (barrel export example)
