---
name: Vitest root quirk
description: How to run server-side vitest tests in this repo
---
Vitest picks up the vite config and resolves its root to `client/`, so server tests are outside the search path and it exits with "No test files found".

**Why:** vite.config.ts sets root to the client directory; vitest inherits it.
**How to apply:** run `npx vitest run --root . server/path/to/file.test.ts`. Vitest is not a package.json dep — it runs via npx.
