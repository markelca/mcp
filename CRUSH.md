# CRUSH.md

# Commands
- Build: npm run server:build
- Build (watch): npm run server:build:watch
- Run dev server: npm run server:dev
- Inspector (dev): npm run server:inspect

# Recommended npm scripts to add (optional)
- "lint": "eslint . --ext .ts"  # add eslint devDependency
- "test": "vitest"             # or jest/mocha depending on preference
- "test:one": "vitest -t <name>"  # run a single test by name (vitest)
  - Alternative single-test commands:
    - npx vitest -- -t "pattern"
    - npx jest -t "pattern"

# Code style guidelines
- Modules: use ESM imports (import x from '...') and explicit file extensions only when required by tooling. Group imports: 1) external packages, 2) internal packages, 3) relative imports; separate groups with a blank line.
- Formatting: adopt Prettier for consistent formatting (2 spaces, single file per module). Configure editor to format on save.
- Types: prefer explicit TypeScript types on function signatures and public APIs; avoid implicit any. Use zod for runtime validation of external inputs (already used).
- Naming: camelCase for variables and functions; PascalCase for types, interfaces, classes; UPPER_SNAKE for constants.
- Exports: prefer named exports for most utilities; default-export only for primary module when it makes sense.
- Error handling: always catch and handle async errors; log useful context (not secrets) and return user-facing messages. Avoid swallowing errors silently. Await fs writes/reads and propagate or handle errors.
- Async: mark I/O helpers async and await side-effect calls (fs.writeFile should be awaited or properly handled).
- Side-effects: keep side-effecting code (file writes, network) in small isolated functions for testability.
- Security: never commit secrets; validate external input with zod and sanitize before persisting.

# Tests
- No test framework detected. Recommended: Vitest for TypeScript (fast, native ESM). To run a single test with vitest: npm run test:one (after adding script) or npx vitest -t "test name".

# Cursor/Copilot rules
- No .cursor/rules/ or .cursorrules detected in repo.
- No .github/copilot-instructions.md detected.

# Notes for agents
- Always run the build (npm run server:build) and typecheck (tsc) before making changes.
- If you add lint/test tooling, add the commands to this file for future agents.