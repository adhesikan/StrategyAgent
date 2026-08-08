# 13 — Production Release Checklist

## Pre-Deploy Gates

Run ALL of these locally before pushing to production.

### Code Quality
- [ ] `git status` reviewed — no unintended changes staged
- [ ] `npm run build` passes — zero build errors
- [ ] `npx vitest run --root .` passes — full test suite (target: 0 failures)
- [ ] `npx tsc --noEmit` — zero **new** TypeScript errors in changed files
  - Pre-existing errors in `portfolio-intelligence-engine.ts`, `agent-worker.ts`, `ask.ts`, `routes.ts`, `routes/agent.ts` are known and excluded from the "new errors" gate

### Security Review
- [ ] No hardcoded API keys, tokens, or passwords in changed files
- [ ] No secret values in documentation
- [ ] New admin endpoints use `isAuthenticated` + `isAdmin` middleware
- [ ] New public endpoints don't expose sensitive data

### Migration Review
- [ ] Schema changes added to `shared/schema.ts`
- [ ] `drizzle-kit push --force` tested locally
- [ ] Startup migrations in `server/index.ts` are `CREATE TABLE IF NOT EXISTS` (idempotent)
- [ ] No manual `ALTER TABLE` in deploy path

### Route Review
- [ ] New static routes registered BEFORE any dynamic `:param` routes that could shadow them
- [ ] `/api/institutional/:symbol` dynamic route is always last in institutional block

### Feature Flags
- [ ] New flags have safe default values (disabled by default unless explicitly required)
- [ ] Feature flag names documented in [02-environments-and-deployment.md](02-environments-and-deployment.md)

### Backward Compatibility
- [ ] API response shapes are backward-compatible OR clients updated simultaneously
- [ ] No breaking changes to shared types without version bump

### Smoke Tests (local dev)
```bash
curl localhost:5000/api/intelligence/briefing | jq .
curl localhost:5000/api/opportunities/today | jq .count
curl localhost:5000/api/intelligence/sectors | jq .count
```

---

## Deploy Steps

```bash
git push origin main   # triggers Railway build
```

Monitor Railway build logs. Deploy typically takes 2–3 minutes.

---

## Post-Deploy Verification

Run within 10 minutes of deployment.

### Must Pass
- [ ] `GET $PROD/api/intelligence/briefing` → HTTP 200 (not 500)
- [ ] `GET $PROD/api/intelligence/sectors` → HTTP 200
- [ ] `GET $PROD/api/intelligence/themes` → HTTP 200
- [ ] Admin login works
- [ ] Dashboard loads without errors
- [ ] `/research` page loads
- [ ] `/intelligence` page loads

### Admin Checks (with admin session)
```bash
curl -b "session=..." $PROD/api/admin/platform-health | jq .health.database.status
curl -b "session=..." $PROD/api/admin/intelligence/diagnostics | jq .briefing.canBuild
```

### Log Check
- [ ] No new 500-level errors in Railway logs
- [ ] No `intelligence_briefing_failed` events
- [ ] Startup migration logs show "completed successfully"

---

## Rollback

If any post-deploy check fails:
1. Navigate to Railway → Deployments
2. Click the previous successful deployment
3. Click "Redeploy"

See [14-disaster-recovery.md](14-disaster-recovery.md) for detailed rollback procedures.
