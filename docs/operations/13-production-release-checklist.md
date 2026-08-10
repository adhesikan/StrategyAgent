# 13 — Production Release Checklist

## Pre-Deploy Gates

Run ALL of these before pushing to production. The master command is:

```bash
npm run test:release
```

This runs all mandatory quality gate suites (see §Quality Gate Commands below).

### Code Quality
- [ ] `git status` reviewed — no unintended changes staged
- [ ] `npm run build` passes — zero build errors
- [ ] `npm run test:release` passes — all quality gate suites pass
- [ ] `npx tsc --noEmit` — zero **new** TypeScript errors in changed files
  - Pre-existing errors in `portfolio-intelligence-engine.ts`, `agent-worker.ts`, `ask.ts`, `routes.ts`, `routes/agent.ts`, and others are known and excluded from the "new errors" gate (see doc 15)

### Security Review
- [ ] No hardcoded API keys, tokens, or passwords in changed files
- [ ] No secret values in documentation
- [ ] New admin endpoints use `isAuthenticated` + `isAdmin` middleware
- [ ] New public endpoints don't expose sensitive data
- [ ] Compliance: no forbidden investment phrases in new labels/messages

### Migration Review
- [ ] Schema changes added to `shared/schema.ts`
- [ ] `drizzle-kit push --force` tested locally
- [ ] Startup ensure functions in `server/routes.ts` are `CREATE TABLE IF NOT EXISTS` (idempotent)
- [ ] No manual `ALTER TABLE` in deploy path

### Route Review
- [ ] New static routes registered BEFORE any dynamic `:param` routes that could shadow them
- [ ] `/api/institutional/:symbol` dynamic route is always last in institutional block
- [ ] `/api/trade-plans/lifecycle/health` registered before `/:id/lifecycle`

### Feature Flags
- [ ] New flags have safe default values (disabled by default unless explicitly required)
- [ ] Feature flag names documented in [02-environments-and-deployment.md](02-environments-and-deployment.md)

### Backward Compatibility
- [ ] API response shapes are backward-compatible OR clients updated simultaneously
- [ ] No breaking changes to shared types without version bump

---

## Quality Gate Commands (Sprint 2.7.6+)

| Command | Scope | Mandatory? |
|---------|-------|-----------|
| `npm run test:smoke` | Service exports, schema, route registration | ✅ Yes |
| `npm run test:regression` | Route ordering, compliance, type contracts | ✅ Yes |
| `npm run test:integration` | Layer boundary chains | ✅ Yes |
| `npm run test:security` | Cross-user isolation, no PII, no tokens | ✅ Yes |
| `npm run test:lifecycle` | Lifecycle state machine, dedup, compliance | ✅ Yes |
| `npm run test:migrations` | Schema presence, migration files, idempotency | ✅ Yes |
| `npm run test:compliance` | Forbidden phrases, disclaimer presence | ✅ Yes |
| `npm run test:db` | Critical table + column contracts | ✅ Yes |
| `npm run test:invariants` | Business logic invariant pins | ✅ Yes |
| `npm run test:idempotency` | Fingerprint determinism, cache correctness | ✅ Yes |
| `npm run test:e2e` | Browser E2E (requires PLAYWRIGHT_TEST_USER) | ⚠️ Recommended |
| `npm run test:smoke:production` | Post-deploy production smoke | ✅ After deploy |
| `npm run test:release` | **Master pre-deploy gate (all above except E2E + prod smoke)** | ✅ Yes |

---

## Deploy Steps

```bash
git push origin main   # triggers Railway build
```

Monitor Railway build logs. Deploy typically takes 2–3 minutes.

---

## Post-Deploy Verification

Run within 10 minutes of deployment.

### Automated Post-Deploy Smoke
```bash
SMOKE_BASE_URL=https://your-app.railway.app \
SMOKE_SESSION_COOKIE="..." \
npm run test:smoke:production
```

### Must Pass (manual if no smoke cookie)
- [ ] `GET $PROD/api/opportunities/today` → HTTP 401 (unauthed — confirms route registered)
- [ ] `GET $PROD/api/trade-plans/lifecycle/health` → HTTP 401 (not 404 — confirms route registered)
- [ ] Admin login works
- [ ] Dashboard loads without errors
- [ ] Platform Health card renders all subsystems
- [ ] Trade Plan detail page loads

### Admin Checks (with admin session)
```bash
curl -b "session=..." $PROD/api/admin/platform-health | jq '.cards | length'
curl -b "session=..." $PROD/api/trade-plans/lifecycle/health | jq .
```

### Log Check
- [ ] No new 500-level errors in Railway logs
- [ ] `trade_plan_activity_table_ready` logged at startup
- [ ] Startup migration logs show "completed successfully"
- [ ] No `[ERROR]` events from trade planning services

---

## Rollback

If any post-deploy check fails:
1. Navigate to Railway → Deployments
2. Click the previous successful deployment
3. Click "Redeploy"

**Schema note (Sprint 2.7.7):** No new DB migrations in this sprint. Rollback is schema-safe.

See [14-disaster-recovery.md](14-disaster-recovery.md) for detailed rollback procedures.

---

## Release Gate Summary (Phase 2.7 → 2.8)

Before Phase 2.8 begins:
- [ ] `npm run test:release` — all suites pass
- [ ] `npm run build` — clean build
- [ ] `npm run test:smoke:production` — production smoke passes
- [ ] drizzle-orm upgrade review scheduled (KL-006)
- [ ] adm-zip upgrade to 0.6.0 scheduled (KL-007)
- [ ] `docs/releases/research-trade-planning-v1-production-readiness.md` signed off

See full certification in `docs/releases/research-trade-planning-v1-production-readiness.md`.
