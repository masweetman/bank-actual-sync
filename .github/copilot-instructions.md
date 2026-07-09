# Copilot Instructions — bank-actual-sync

## Stack

- **Backend**: Node.js 22, TypeScript 5, Express, Socket.io, SQLite (`node:sqlite` built-in), Vitest
- **Frontend**: React 18, TypeScript 5, Vite, Vitest + jsdom + Testing Library
- **Monorepo**: npm workspaces (`backend/`, `frontend/`)

---

## Development best practices

### Tests are mandatory for every change

- Write or update tests for every code change before considering it done.
- Run the full test suite before committing: `npm test`
- Backend tests run with an in-memory SQLite DB automatically — no setup needed.
- Frontend tests mock all API calls with `vi.mock` — no real server needed.
- Test files live next to the source files they cover: `src/foo.ts` → `src/foo.test.ts`.

### TypeScript — no `any`, no suppressed errors

- Never use `as any` or `// @ts-ignore` except where an upstream SDK provides no types (document the reason with a comment).
- Both `backend/tsconfig.json` and `frontend/tsconfig.json` use `"strict": true`. Keep it that way.
- Test files are excluded from the production `tsc` build (`backend/tsconfig.json` excludes `*.test.ts`).

### Secrets and sensitive data

- Never hardcode credentials, tokens, or keys in source files.
- All secrets passed to SQLite must go through `settingsRepo.set()` — the repo encrypts designated keys automatically (AES-256-GCM).
- Never log secrets: `settingsRepo.getPublic()` strips all sensitive keys before returning settings to the API.

### Error handling

- Route handlers return structured `{ error: string }` JSON with an appropriate HTTP status code.
- Do **not** forward raw `err.message` directly to the client — map to a safe user-facing message and log the detail server-side.
- Client/job functions throw `Error` instances; callers catch and convert to result objects (`{ errors: string[] }`).

### Logging

- Use `console.log` / `console.warn` / `console.error` with a bracketed module prefix on every line.
- Format: `[module] message` — e.g. `[syncJob]`, `[scheduler]`, `[server]`.

### Database

- All DB access goes through the repository layer (`backend/src/db/*Repository.ts`). Never write raw SQL in route handlers or jobs.
- Schema migrations are inline `ALTER TABLE` statements in `initDb()` (`backend/src/db/schema.ts`). Add new migrations at the bottom; guard each with a `try/catch` so repeated startup is safe.
- The `DB_PATH` environment variable allows tests to use `:memory:`. Never hard-code the DB path elsewhere.

### API routes

- All protected routes must use the `requireAuth` middleware.
- Validate and whitelist request body fields before persisting — never pass `req.body` directly to a repository.
- Only allow cron expressions through `cron.validate()` before calling `settingsRepo.set('schedule_cron', ...)`.

### Frontend state

- Auth state is managed by `AuthProvider` / `useAuth` (a discriminated-union state machine). Do not bypass it with local `useState` for auth status.
- All backend calls go through `frontend/src/services/api.ts` or `settingsApi.ts` — never use raw `fetch` in components or hooks.

### Adding a new feature checklist

1. Write the test(s) first (or alongside the implementation).
2. Implement the change.
3. Run `npm test` — all 137+ tests must pass.
4. Run `npm run build` — TypeScript compilation must succeed with zero errors.
5. If the change adds a new env var, update `.env.example` with a description.
6. If the change adds a new setting stored in SQLite, decide if it belongs in `ENCRYPTED_KEYS` in `settingsRepository.ts`.
