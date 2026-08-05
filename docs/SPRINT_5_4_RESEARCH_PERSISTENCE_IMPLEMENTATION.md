# Sprint 5.4C — Research Record & Decision Journal: Implementation Reference

## Overview

Sprint 5.4C introduces a secure, user-owned persistence foundation for immutable deterministic Research Evidence Records and user-authored Decision Journal entries. This is a research and decision-support feature — it does not modify MCP algorithms, scanner logic, ranking, recommendation, portfolio, options, or risk logic, and does not add autonomous recommendations or automatic execution.

---

## 1. Data Model

### `research_records`

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR (UUID) | PK, `gen_random_uuid()` |
| `user_id` | VARCHAR | From server session — never client-supplied |
| `request_id` | VARCHAR | Brain requestId that produced the evidence |
| `conversation_id` | VARCHAR (nullable) | Conversation at time of save; record survives conversation deletion |
| `parent_record_id` | VARCHAR (nullable) | For refresh chains; must belong to same user |
| `domain` | TEXT | One of 6 validated values |
| `schema_version` | TEXT | Must be `"1.0"` |
| `symbol` | TEXT (nullable) | Primary symbol |
| `symbols` | TEXT[] | Multiple symbols for search/portfolio domains |
| `normalized_request_summary` | TEXT | Deterministic summary of the research request |
| `verdict` | TEXT | **Immutable** |
| `status` | TEXT (nullable) | Optional status qualifier |
| `strategy` | TEXT (nullable) | |
| `strategy_display_name` | TEXT (nullable) | |
| `direction` | TEXT (nullable) | bullish/bearish/neutral |
| `instrument` | TEXT (nullable) | |
| `qualification_status` | TEXT (nullable) | |
| `confidence` | TEXT | `high`/`medium`/`low`/`none` — **Immutable** |
| `data_quality` | JSONB | `{estimated?,simulated?,partial?,stale?}` — **Immutable** |
| `reasons` | TEXT[] | **Immutable** |
| `warnings` | TEXT[] | **Immutable** |
| `watch_conditions` | TEXT[] | |
| `source_tools` | TEXT[] | **Immutable** |
| `source_timestamps` | TEXT[] | **Immutable** |
| `limitations` | TEXT[] | |
| `domain_snapshot` | JSONB | Full domain-specific evidence — **Immutable** |
| `title` | TEXT | User-editable |
| `user_label` | TEXT (nullable) | User-editable |
| `tags` | TEXT[] | User-editable |
| `archived` | BOOLEAN | Soft-archive (user-toggled) |
| `generated_at` | TIMESTAMP | When Brain evidence was generated — **Immutable** |
| `created_at` | TIMESTAMP | Row creation |
| `updated_at` | TIMESTAMP | Last metadata update |

### `decision_journal_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR (UUID) | PK |
| `user_id` | VARCHAR | Must match parent research record's `user_id` |
| `research_record_id` | VARCHAR | FK → `research_records.id` ON DELETE CASCADE |
| `thesis` | TEXT (nullable) | User-authored |
| `entry_plan` | TEXT (nullable) | User-authored |
| `risk_plan` | TEXT (nullable) | User-authored |
| `exit_plan` | TEXT (nullable) | User-authored |
| `notes` | TEXT (nullable) | User-authored |
| `expected_conditions` | TEXT (nullable) | User-authored |
| `invalidation_conditions` | TEXT (nullable) | User-authored |
| `user_decision` | TEXT | `researching`/`watching`/`passed`/`prepared_trade`/`entered_manually`/`closed_manually` |
| `outcome_review` | TEXT (nullable) | User-authored post-trade review |
| `lessons_learned` | TEXT (nullable) | User-authored |
| `user_recorded_entry_price` | REAL (nullable) | User-entered only |
| `user_recorded_exit_price` | REAL (nullable) | User-entered only |
| `user_recorded_quantity` | REAL (nullable) | User-entered only |
| `opened_at` / `closed_at` | TIMESTAMP (nullable) | User-entered timestamps |
| `created_at` / `updated_at` | TIMESTAMP | |

---

## 2. Ownership Model

- `userId` is **always** derived from `req.session.userId` set by the `isAuthenticated` middleware.
- No client-supplied `userId` is accepted anywhere in the persistence layer.
- All reads and writes include `AND user_id = <authenticatedUserId>` in the WHERE clause.
- Cross-user parent record linking is rejected with a `NOT_FOUND` error (same as §4 spec).
- Journal entries must belong to the same user as their research record — enforced by checking research record ownership before journal operations.
- Returns **404** (not 403) when a resource is not found or not owned, to avoid revealing existence of another user's records.

---

## 3. Save-Handle Architecture

```
TraderBrain produces result
  → extractResearchEvidence()     [server/trader-brain/research-evidence-extractor.ts]
  → validateResearchEvidence()    [server/services/research-evidence-validator.ts]
  → issueResearchSaveHandle()     [server/services/research-save-handle.ts]
  → { handleId, domain, titleSuggestion, expiresAt } returned to frontend
  
User clicks "Save Research"
  → POST /api/research-records { handleId }
  → resolveResearchSaveHandle(handleId, userId)   ← validates user, TTL, consumed
  → ResearchRecordService.createFromEvidence()
  → record persisted
```

### Handle properties
- **Opaque 256-bit random hex** — stored in-process Map keyed by SHA-256 hash
- **10-minute TTL** — requests after expiry return HTTP 410 Gone
- **Single-use** — first successful `resolveResearchSaveHandle()` marks it consumed
- **User-bound** — resolving with a different `userId` returns `WRONG_USER` (→ 404)
- **Server-side only** — never stored in browser localStorage; not sent to OpenAI
- **No credentials** — handle contains only: userId, requestId, validated evidence, title, tags, expiresAt

---

## 4. Evidence-Validation Synchronization

The `ResearchEvidenceRecord` schema (version `"1.0"`) is defined locally in `server/services/research-save-handle.ts`. The validator in `server/services/research-evidence-validator.ts` enforces:

| Check | Action |
|---|---|
| Unknown schema version | Reject |
| Unknown domain | Reject |
| Invalid confidence | Reject |
| Non-ISO date strings | Reject |
| Non-finite numbers anywhere in snapshot | Reject |
| Unknown top-level fields | Reject |
| Oversized strings (>8 KB) | Reject |
| Oversized arrays (>200 items) | Reject |
| Domain-snapshot missing required structure | Reject |
| Forbidden sensitive keys anywhere in snapshot | Reject (no value logged) |

**Synchronization ownership:** This codebase owns the schema definition. When the MCP service evolves its `ResearchEvidenceRecord` type, the version must be bumped and both the MCP and VCP Trader validator updated together. The validator rejects `schemaVersion !== "1.0"` until a migration path is added.

---

## 5. Immutable vs User-Editable Fields

### Immutable after creation
- `verdict`, `reasons`, `warnings`, `confidence`
- `sourceTools`, `sourceTimestamps`
- `domainSnapshot`, `generatedAt`
- `domain`, `schemaVersion`, `requestId`
- `normalizedRequestSummary`, `dataQuality`, `limitations`

### User-editable
- `title`, `userLabel`, `tags`, `archived`

### Journal fields (all user-authored)
- All free-text fields (`thesis`, `entryPlan`, `riskPlan`, etc.)
- `userDecision` — except `entered_manually` and `closed_manually` which require `recordExplicitManualDecision()`

---

## 6. Journal Boundary

The Decision Journal is strictly user-authored:
- Content is **never inferred** from Trade Builder clicks, broker events, or conversation state.
- `entered_manually` and `closed_manually` states require explicit user action via `PATCH /api/research-records/:id/journal?manual=true` — they **cannot** be set via the regular `userDecision` field.
- **No brokerage reconciliation** in this sprint.
- **No automatic state transitions** based on external data.

---

## 7. Retention and Deletion

| Scenario | Behavior |
|---|---|
| User deletes research record | Hard delete; journal entry cascades (FK ON DELETE CASCADE) |
| User archives research record | `archived = true`; record retained, hidden from default list |
| Conversation deleted | Research record survives; `conversation_id` is nullable |
| Parent record deleted | Child refresh records' `parent_record_id` becomes a dangling FK (no cascade to children — children are independent records) |
| User deletes journal | Hard delete; research record untouched |
| User deletes account | Application-level cascade required (not in this sprint) |

**Refresh chains:** When a user re-runs analysis on the same symbol, a new record can be linked via `parent_record_id`. Deleting the parent does not delete children — they remain as standalone records.

---

## 8. Security Controls

### Forbidden field scanner (`scanForForbiddenKeys`)
Recursively scans the full `domainSnapshot` for any of these keys before persistence:

```
accountId, accountNumber, brokerAccount, brokerId, connectionId,
userId (inside evidence payload), accessToken, refreshToken, serviceToken,
apiKey, authorization, optionsContextToken, portfolioContextToken,
rawPositions, rawPortfolio, providerPayload, stack,
systemPrompt, developerPrompt, chainOfThought
```

On violation: persistence rejected; safe structured error emitted; **offending value never logged**.

### Additional controls
- Evidence content comes from server-held save handle — never from raw client-submitted JSON.
- Save handles expire in 10 minutes and are single-use.
- Session-based `userId` — immune to host-header injection.
- All ownership checks use `AND user_id = ?` in SQL WHERE clauses.

---

## 9. API Contracts

### Research Records

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/api/research-records` | `{ handleId, title?, userLabel?, tags?, conversationId? }` | 201 `{ record }` |
| GET | `/api/research-records` | `?domain=&symbol=&archived=&limit=&offset=` | 200 `{ records, count }` |
| GET | `/api/research-records/:id` | — | 200 `{ record }` |
| PATCH | `/api/research-records/:id/metadata` | `{ title?, userLabel?, tags?, archived? }` | 200 `{ record }` |
| POST | `/api/research-records/:id/archive` | — | 200 `{ record }` |
| DELETE | `/api/research-records/:id` | — | 204 |

### Decision Journal

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/api/research-records/:id/journal` | — | 201 `{ entry }` (create or get) |
| GET | `/api/research-records/:id/journal` | — | 200 `{ entry }` |
| PATCH | `/api/research-records/:id/journal` | Journal text fields | 200 `{ entry }` |
| PATCH | `/api/research-records/:id/journal?manual=true` | `{ state, entryPrice?, exitPrice?, quantity? }` | 200 `{ entry }` |
| DELETE | `/api/research-records/:id/journal` | — | 204 |

All endpoints: `isAuthenticated` required. `userId` from session only.

---

## 10. TraderBrain Integration

After the Sprint 5.1 Brain result is confirmed valid, the Sprint 5.4C block runs:

```typescript
// server/routes/ask.ts (Sprint 5.4C block)
const extraction = extractResearchEvidence(brainResult, portfolioIntelligence);
if (extraction) {
  const validation = validateResearchEvidence(extraction.evidence);
  if (validation.ok) {
    const { metadata } = issueResearchSaveHandle(userId, validation.record, title, tags);
    // metadata added to response as researchSave
  }
}
```

### Domain → Brain Intent mapping

| Brain Intent | Evidence Domain |
|---|---|
| `ANALYZE_SYMBOL` | `SYMBOL_ANALYSIS` |
| `RECOMMEND_SYMBOL_TRADE` | `TRADE_RESEARCH` |
| `RANK_MARKET_TRADES` | `MARKET_OPPORTUNITY_SEARCH` |
| `PLAN_PORTFOLIO_TRADE` | `PORTFOLIO_GOAL_RESEARCH` |
| Portfolio intelligence present | `PORTFOLIO_IMPACT` (takes priority) |
| `COMBINED_ANALYSIS_RECOMMENDATION` | `SYMBOL_ANALYSIS` (analysis first), else `TRADE_RESEARCH` |
| `EDUCATION_PLUS_ACTION` | **No handle** |
| `EXPLAIN_CONCEPT` | **No handle** |
| `MARKET_RESEARCH` | **No handle** |
| Status `error` or `unavailable` | **No handle** |

### Response field added to `/api/ask`

```typescript
researchSave?: {
  available: true;
  handleId: string;         // opaque; not the evidence ID
  domain: ResearchDomain;
  titleSuggestion: string;  // deterministic; user may edit before saving
  tagSuggestions: string[];
  expiresAt: string;        // ISO timestamp; UI should show "Save expires in Xm"
}
```

---

## 11. Known Limitations

- **No OPTIONS_RESEARCH evidence extraction yet** — the domain is validated and schema-supported but no Brain intent maps to it yet. The extractor returns `null` until an `ANALYZE_SYMBOL_OPTIONS` intent exists.
- **No account-level portfolio data in evidence** — `SafePortfolioAwareness` is scrubbed; `PORTFOLIO_IMPACT` snapshot contains only derived/safe fields (concentration %, cash status labels, not raw balances).
- **No real-time refresh** — evidence is a snapshot at save time; users must manually save again for updated data.
- **No cross-device sync for save handles** — handles are in-process Map; a server restart or multi-instance deploy loses pending handles.
- **No search/full-text query** — list endpoint supports simple filter by domain/symbol/archived; no fuzzy search yet.
- **No account-level delete cascade** — deleting a user account does not automatically delete research records in this sprint.

---

## 12. Next UI Implementation Steps

1. **Save Research button**: rendered when `researchSave.available === true` in the `/api/ask` response; disabled after `expiresAt`.
2. **Title/tag editor**: pre-fill from `researchSave.titleSuggestion` + `researchSave.tagSuggestions`; editable before `POST /api/research-records`.
3. **Research Record list page**: call `GET /api/research-records` with filter controls (domain chip, symbol search, archived toggle).
4. **Research Record detail page**: display all evidence fields (immutable) + editable metadata + Decision Journal section.
5. **Decision Journal UI**: free-text fields + decision state selector; manual execution flow behind an explicit "Mark as Entered" action.
6. **Expiry UX**: show remaining time for `researchSave`; if expired, offer to re-run analysis to get a fresh save handle.
