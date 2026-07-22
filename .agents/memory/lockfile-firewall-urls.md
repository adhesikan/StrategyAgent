---
name: Lockfile package-firewall URLs break deploys
description: package-lock.json entries resolving to package-firewall.replit.local fail npm ci on the deployment builder
---

Rule: before publishing, package-lock.json must not contain `http://package-firewall.replit.local/npm/...` resolved URLs — rewrite them to `https://registry.npmjs.org/` (integrity hashes stay valid).

**Why:** the firewall proxy is only reachable inside the workspace. On the deploy builder, `npm ci` fails, dev deps like tsx are missing, and `npm run build` exits 127.

**How to apply:** if a deploy fails at `npm ci`, run `grep -c package-firewall package-lock.json`; if >0, string-replace the prefix with the public registry URL.
