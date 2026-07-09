# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- **Primary test framework**: None configured.
- **Assertion/mocking tools**: None.
- **Commands**: No `test` script exists in `backend/package.json`, `frontend/package.json`, or the root `package.json`.

```bash
# No test command available
# npm test → exits with error (no test script)
```

> [ASK USER] Is there a planned test framework? (e.g., Vitest for both workspaces, Jest for backend?)

### 2) Test Layout

- **Test file placement**: No test files exist anywhere in the repository.
- **Naming convention**: [TODO] — no precedent.
- **Setup files**: [TODO] — none present.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | No | — | No test framework; no unit tests |
| Integration | No | — | No test framework; no integration tests |
| E2E | No | — | No test framework; no E2E tests |

### 4) Mocking and Isolation Strategy

- **Main mocking approach**: [TODO] — no tests exist to establish a pattern.
- **Isolation guarantees**: [TODO].
- **Common failure mode**: [TODO].

> **Note**: The codebase structure (thin API routes delegating to client wrappers and repositories) is inherently testable. The Repository and Adapter patterns mean the database and external APIs can be injected or swapped for mocks without major refactoring. However, `settingsRepo` and `repository` are module-level singletons that would need to be replaced or mocked at the module level (e.g., with `jest.mock`/`vi.mock`).

### 5) Coverage and Quality Signals

- **Coverage tool**: None.
- **Coverage threshold**: None.
- **Current coverage**: 0% (no tests).
- **Known gaps**: All application logic — auth flows, sync orchestration, repository operations, Plaid/Teller/Actual client wrappers, encryption utilities — has zero automated test coverage.

### 6) Evidence

- `backend/package.json` — no `test` script, no Jest/Mocha/Vitest in `devDependencies`
- `frontend/package.json` — no `test` script, no Vitest in `devDependencies`
- `package.json` (root) — no `test` script
- `.gitignore` — mentions "Test coverage" section header but no test output directories (signals intent but no implementation)
