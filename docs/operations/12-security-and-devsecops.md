# 12 — Security & DevSecOps

## Secret Handling

### Rule: Never commit secrets
- All secrets are managed via Railway environment variables (production) and Replit Secrets (development)
- `.env` files must never be committed to git
- Secret values must never appear in documentation, logs, or API responses

### Required Secrets
See [02-environments-and-deployment.md](02-environments-and-deployment.md) for the full list of environment variables. Store all values in Railway → Project → Variables.

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
