# 12 — Security & DevSecOps

## Secret Handling

### Rule: Never commit secrets
- All secrets are managed via Railway environment variables (production) and Replit Secrets (development)
- `.env` files must never be committed to git
- Secret values must never appear in documentation, logs, or API responses

### Required Secrets
See [02-environments-and-deployment.md](02-environments-and-deployment.md) for the full list of environment variables. Store all values in Railway → Project → Variables.

---

## Research Collections — Security (Sprint 2.5.1)

### Ownership enforcement

- User collections are only visible to their owner (`userId` match).
- System collections are visible to all authenticated users (`userId IS NULL`).
- `updateUserCollection`, `deleteUserCollection`, `addSymbolToCollection`, `removeSymbolFromCollection` all require `userId` match before any DB mutation.
- Routes return 404 (not 403) for unauthorized access to prevent existence leakage.

### No opportunity data duplication

- `collection_symbols` stores only ticker symbols — never scores, prices, evidence, or any canonical opportunity data.
- All opportunity data is resolved on-demand from `getOpportunityIntelligence()` (in-memory, no extra DB query).
- A user who deletes their collection does not affect the shared Opportunity Intelligence Engine.

### Cascade delete safety

`deleteUserCollection` removes in this order: symbols → follows → favorites → pins → collection record. All deletions are scoped to the collection ID — no cross-user data is affected.

### Structured log rules

Log events: `collection_created`, `collection_deleted`, `collection_duplicated`, `collection_seed_started`, `collection_seed_complete`. Fields: `collectionId`, `event`, `timestamp`. `userId` always redacted to `"[redacted]"`.

### Seeding safety

`seedSystemCollections()` is idempotent — guarded by `_seedComplete` in-memory flag and a DB existence check per collection key. Re-running on restart cannot create duplicates. System collections cannot be modified by users (PATCH/DELETE return 404).

### Compliance enforcement

All registry descriptions, route response keys, and service functions use "research candidate" vocabulary. No "recommendation", "buy", "sell", "target price" appears in any route response or type definition.

---

## Opportunity Intelligence Engine — Security (Sprint 2.5.0)

### Compliance language enforcement

All routes and services must use "Research Candidate" / "Investment Candidate" / "Trade Candidate" language. Prohibited terms in any response key, label, or value: `recommendation`, `buy` (as directive), `sell` (as directive), `target price`, `strong buy`.

Enforced by 8 structural tests in `server/routes/__tests__/opportunity-intelligence.test.ts`.

### No new attack surface

The engine is read-only (GET routes only). All routes require `isAuthenticated`. No POST, PUT, or DELETE routes.

### No PII or financial credentials exposed

The canonical opportunity model contains only: scanner-derived scores, company metadata (symbol, name, sector, industry from public market data), and curated theme memberships. No user data, broker tokens, account numbers, or portfolio information.

### Evidence panels are deterministic

`primaryEvidence[]` and `secondaryEvidence[]` are assembled deterministically from existing scanner reasons/warnings and company metadata. LLM is **not** invoked during assembly. Evidence panels never invent signals.

### LLM consumption rules

When the Opportunity Intelligence Engine output reaches Ask AI (via the `opportunitySearch` pathway in `server/routes/ask.ts`), the system prompt explicitly instructs the LLM: it may only summarize/explain ranked candidates; it cannot invent/add/remove/re-rank candidates, fabricate contracts/metrics, or call additional tools.

---

## Broker Synchronization — Security (Sprint 2.4.2)

### Token handling

- Broker OAuth tokens stored encrypted (AES-256-GCM via `server/crypto.ts`).
- `server/routes/broker-sync.ts` uses `safeConnectionInfo()` — never returns `accessToken`, `refreshToken`, or `sandboxAccessToken` to the client.
- All broker API calls go through `getBrokerPositions()` (centralized token refresh + caching). No direct API calls in the sync service.

### Structured log rules (Part 9 enforcement)

Every `broker_sync_*` log event is a JSON object. Fields permitted: `event`, `portfolioId`, `provider`, `importedCount`, `updatedCount`, `deletedCount`, `durationMs`, `errorCode`, `timestamp`. Fields **never** logged: `accessToken`, `refreshToken`, `accountId` (account number), `userId` (redacted to `"[redacted]"`).

### Concurrent sync guard

`runningSyncs` Set prevents parallel syncs per portfolio. Routes return 409 Conflict if sync already running. `runningSyncs.delete()` is in `finally` block — guaranteed cleanup even on error.

### Ownership verification

All sync routes verify `portfolios.userId === req.session.userId` before any DB mutation. Routes return 404 (not 403) to avoid leaking portfolio existence to non-owners.

### Disconnect behavior

`DELETE /api/portfolio/broker/disconnect/:portfolioId` converts the portfolio to `"manual"` type (keeps all positions). Does NOT revoke the broker OAuth token — that remains the user's separate choice.

### No admin details exposed to users

`/portfolio/connect` page shows only: sync status, last sync time, imported count, duration. No account numbers, tokens, or internal provider IDs are rendered.

---

## Portfolio Upload Disclosures — User-Facing (Sprint 2.4.1A)

### What users see (disclosure inventory)

All portfolio upload flows display mandatory privacy and compliance disclosures. No checkbox consent — inline notice adjacent to the upload button. Disclosures are rendered client-side from source; they are not served from a CMS or database.

**CSV/XLSX flows:**
- Privacy & Data Use notice (§1): file used only to import holdings, not retained, stored after confirm
- Consent notice (§6): "By continuing, you acknowledge that the file will be processed as described above."
- Preview warning (§8): "Review carefully before importing."
- Confirm disclaimer (§9): acknowledgement + research / not-investment-advice

**Screenshot / PDF flows:**
- Full Privacy & Data Use notice (§1): sensitive financial info, AI extraction, review required, data minimization
- AI Extraction disclosure (§3): AI service for data extraction only; always verify values
- File retention notice (§4): file discarded after extraction; only confirmed data stored
- PII minimization warning (§5): may contain account numbers, addresses, tax IDs; upload minimum
- Consent notice (§6): same as CSV/XLSX
- Preview warning (§8): "AI-extracted fields may be inaccurate"
- Confirm disclaimer (§9): same as CSV/XLSX

### Privacy link target

All disclosures link to `/privacy` — the public-facing privacy page. No links to `/admin`, the operations manual, or DevSecOps documentation are exposed to end users.

### Research disclaimer wording (canonical)

> "Portfolio information is used for research and analytics purposes. VCP Trader AI does not make investment decisions for you, and imported portfolio data does not constitute investment advice or a recommendation to buy, sell, hold, or rebalance any security."

This text must not be removed without legal review.

---

## Portfolio Document Intake — Privacy & Security (Sprint 2.4.1)

### Upload Endpoints

| Endpoint | Accepts | Auth |
|----------|---------|------|
| `POST /api/portfolio/import/image` | PNG, JPG, WEBP (≤10 MB) | Required |
| `POST /api/portfolio/import/pdf` | application/pdf (≤15 MB, ≤50 pages) | Required |

### File Handling

- **No disk writes.** Both endpoints use multer `memoryStorage`. The file buffer never touches the filesystem.
- **Buffer discarded after extraction.** After `extractFromImage()` or `extractFromPdf()` returns, `req.file.buffer = Buffer.alloc(0)` is set explicitly.
- **Original files are NOT retained.** After extraction the buffer goes out of scope and is garbage-collected. No persistent storage of uploaded content.

### AI Extraction Scope

- AI (GPT-4o) is used **only** to transform unstructured image/text into structured candidate rows.
- AI is **not** used to make investment decisions, rate positions, or generate recommendations.
- The AI prompt explicitly states: "Do NOT produce buy/sell/hold recommendations. Extract data only."
- AI responses are treated as untrusted candidate input — all rows pass through deterministic `normalizePortfolioPositions()` before any use.

### Logging Rules

- **Only safe telemetry** is logged: `sourceType`, `processingDurationMs`, `rowsDetected`, `rowsValid`, `rowsInvalid`, `lowConfidenceCount`, `resultStatus`, `detectedInstitution`.
- **Never logged:** raw file content, extracted text, portfolio position values (averageCost, costBasis, quantity), account numbers, user identifiers beyond those needed for routing.

### PII Redaction

`redactSensitiveText()` in `portfolio-document-extractor.ts` strips:
- 9-digit account numbers (`\b\d{9}\b`)
- `account: XXXXX` patterns
- SSN format (`\d{3}-\d{2}-\d{4}`)
- Long numeric IDs (9–12 digits)
- Email addresses
- IP addresses

Redaction is applied before any text passes through a log statement.

### User Isolation

- Preview sessions are UUID-identified, bound to `userId`, and have a 30-minute TTL.
- `claimPreview()` enforces: `session.userId !== userId → reject`.
- Preview entries are deleted on claim (single-use). A second confirm attempt on the same `previewId` returns 400.

### Sensitive Statement Classification

Brokerage statements contain highly sensitive personal financial data. Additional rules:
- Never log full statement text
- Never log account identifiers or routing numbers
- Do not persist the original uploaded file after extraction
- All extraction requests to GPT-4o contain only the minimum text necessary (holdings table area, not the full statement)

---

## Railway/Nixpacks ARG/ENV Warnings

Railway's Nixpacks build system may generate warnings like:
```
Warning: Secrets found in ARG or ENV
```

**Classification:**
- These warnings are generated warnings, not confirmed exposure events
- `ARG` values in Dockerfiles are not exposed to running containers
- `ENV` at build time may be baked into the image layer — avoid putting secrets in `ENV` during build
- All runtime secrets should be Railway "Variables" (injected at runtime, not build time)

**Safe remediation roadmap:**
1. Do not set secret values in `ENV` statements during build
2. Use Railway Variables → injected as environment variables at runtime
3. The current setup (secrets in Railway Variables, not in code) is the approved pattern

---

## Bearer Token Handling

### MCP Service Token
- `MCP_SERVICE_TOKEN` is passed as `Authorization: Bearer <token>` in server-to-MCP requests
- Never forwarded to the browser or included in API responses
- Server logs redact any field matching `/key|token|secret|password|auth|credential|bearer/i`

### Broker OAuth Tokens
- Broker OAuth flows complete server-side
- Tokens are encrypted with `BROKER_TOKEN_KEY` before storage
- Tokens are passed to MCP as opaque short-lived handles — never raw credentials

### JWT/Session Secrets
- `AUTH_JWT_SECRET`: JWT signing key — never in response bodies or logs
- `SESSION_SECRET`: Express session — never in response bodies or logs

---

## API Key Exposure Prevention

1. **Logging redaction:** `server/lib/structured-log.ts` redacts fields matching secret key patterns
2. **URL redaction:** Twelve Data API key is redacted from any logged URL: `redactApiKey(url)`
3. **Admin endpoints:** Diagnostics and health endpoints never return credential values, only boolean presence checks (`configured: true/false`)

Example (safe):
```json
{
  "tradierConfigured": true,
  "tradeStationConfigured": false
}
```
Example (unsafe — never do this):
```json
{
  "tradierClientId": "abc123"   ← NEVER
}
```

---

## Admin Endpoint Authorization

All `/api/admin/*` endpoints require:
1. `isAuthenticated` — valid session with `userId`
2. `isAdmin` — `user.role === "admin"`

Platform health routes follow the same pattern:
```typescript
app.get("/api/admin/platform-health", isAuthenticated, isAdmin, handler)
```

The client-side `AdminOnly` component provides UI-level gating but is NOT a security boundary — server-side auth is the authoritative check.

---

## Portfolio / User Isolation

- User portfolio data is never included in public API responses
- MCP receives an opaque token (not raw account IDs or balances)
- `computePortfolioAwareness()` runs server-side; results are scrubbed before reaching client or LLM

---

## Dependency Scanning

Run before production deploy:
```bash
npm audit          # Check for known vulnerabilities
```

Consider adding to CI/CD pipeline. Critical/high findings block release; medium findings are tracked.

---

## Least Privilege Principles

- Database user should have SELECT/INSERT/UPDATE/DELETE only — no DDL in production
- MCP service token scoped to required tools only
- Admin role is separate from regular user role — do not auto-promote users

---

## Logging Redaction Policy

The `logStructured()` function in `server/lib/structured-log.ts` automatically redacts any field whose key matches:
```regex
/key|token|secret|password|auth|credential|bearer/i
```

Pipelines must use `logStructured()` rather than `console.log()` for events that might include user data or configuration values.

Stack traces in logs are truncated to first 6 frames to avoid leaking internal paths.

---

## AI Research Workspace — Security (Sprint 2.5.2)

### Conversation ownership

All conversation read/write/delete/pin operations verify `userId` match before any DB access. Routes return 404 (not 403) to prevent existence leakage. No cross-user conversation access is possible.

### AI output trust boundary

AI responses are stored as jsonb in `workspace_messages.structured_content`. The AI is forbidden (via system prompt) from inventing opportunity scores, prices, or institutional positions. All factual data is sourced deterministically from `assembleResearchContext()` which reads from the Opportunity Intelligence Engine, Collection Service, and Intelligence Snapshot Store — not from any user-supplied input.

### Prompt injection prevention

User question is serialized to JSON as part of the user message (not injected into the system prompt). The system prompt is built server-side from mode/scope/context only. Maximum tickers: 4 (capped in route). Maximum question length: 500 characters (inherited from validation).

### Context scope gate

`future_portfolio` scope is defined in types but not wired to actual portfolio positions — the context assembler treats it as equivalent to empty (produces diagnostics, not portfolio data). Portfolio data cannot reach the AI via workspace scope.

### AI compliance enforcement

System prompt explicitly forbids: "recommendation", "buy", "sell", "target price" as output keys. Every mode-specific prompt includes the NEVER list. Disclaimer is server-generated and appended to every response — the AI cannot suppress it.

### Structured log rules

No user questions, AI responses, or ticker symbols are logged. Logs record only: `conversationId`, `event`, `timestamp`. UserId is never logged.
