# Sprint 5.4D — Save Research UI: Implementation Reference

## 1. Save Workflow

When the backend mints a save handle, `/api/ask` returns:

```typescript
researchSave?: {
  available: true;
  handleId: string;       // opaque 256-bit hex
  domain: ResearchDomain;
  titleSuggestion: string;
  tagSuggestions: string[];
  expiresAt: string;      // ISO timestamp
}
```

The `SaveResearchButton` component (`client/src/components/save-research-button.tsx`) renders when `data.researchSave?.available === true` in the Ask AI response card.

### Save flow steps

1. User sees **Save Research · Xm** button (X = minutes until expiry)
2. User clicks → small `Dialog` opens with pre-filled title + tags
3. User may edit title, personal note (userLabel), or tags
4. User clicks **Save** → `POST /api/research-records` with `{ handleId, title, userLabel?, tags }`
5. On success: button transitions to **Saved** + "Open record" link to `/research/:id`
6. On expiry (410): message shown — "run analysis again to create a fresh snapshot"
7. On already-consumed (409): "Research already saved"

### What is submitted

Only the server-issued opaque `handleId` + user-authored metadata (title, userLabel, tags). **Never** submitted:
- ResearchEvidenceRecord content
- MCP tool payloads
- Account IDs, context tokens, or raw portfolio data

---

## 2. Handle Behavior

| State | HTTP from server | Client behavior |
|---|---|---|
| Valid, unused | 201 Created | Saved state + record link |
| Expired (>10 min) | 410 Gone | Expired message shown; no retry |
| Already consumed | 409 Conflict | "Already saved" message |
| Wrong session | 401 Unauthorized | "Session error — please refresh" |
| Server error | 5xx | Generic error toast |

Handle IDs are **never**:
- Stored in `localStorage`
- Placed in URLs
- Sent to analytics
- Logged

---

## 3. Library Routes

| Route | Component | Description |
|---|---|---|
| `/research` | `ResearchLibraryPage` | Paginated list with filters |
| `/research/:id` | `ResearchDetailPage` | Structured record summary + metadata editor + journal |

Routes added to `client/src/App.tsx`. Nav item ("My Research") added to `client/src/components/top-nav.tsx`. The label "My Research" is distinct from any existing "Education & Research" editorial content.

---

## 4. Filtering

Library page supports server-backed query parameters via `GET /api/research-records`:

| Filter | Parameter | UI control |
|---|---|---|
| Symbol / title / tag | `symbol` | Text search input |
| Domain | `domain` | Select dropdown |
| Archived | `archived=true` | Toggle button |
| Pagination | `limit`, `offset` | Previous/Next buttons |

Text search (`symbol` param) is applied over: symbol, title, userLabel, tags. **Not** over hidden evidence fields (domainSnapshot, reasons, etc.).

---

## 5. Metadata Permissions

### Editable by owner (via `PATCH /api/research-records/:id/metadata`)
- `title` — max 200 chars
- `userLabel` — max 500 chars, optional personal note
- `tags` — max 10 tags; normalized to `[a-z0-9-]` with underscores → hyphens
- `archived` — boolean soft-archive

### Not editable (immutable after creation)
- `verdict`, `confidence`, `reasons`, `warnings`
- `sourceTools`, `sourceTimestamps`, `generatedAt`
- `domainSnapshot`, `schemaVersion`, `domain`
- `normalizedRequestSummary`, `dataQuality`, `limitations`

The `MetadataEditor` component (inside `ResearchDetailPage`) only renders inputs for the four editable fields. There are no edit controls for immutable evidence fields anywhere in the UI.

---

## 6. Domain Renderers

All six domains have bounded summary components in `client/src/components/research-domain-summary.tsx`. Only fields present in the stored record are rendered.

| Domain | Component behavior |
|---|---|
| `SYMBOL_ANALYSIS` | VCP: pattern, stage, resistance, support, contractions, sequence |
| `TRADE_RESEARCH` | Top 3 recommendations: symbol, strategy, direction, qualification, maxRisk |
| `MARKET_OPPORTUNITY_SEARCH` | Up to 5 ranked candidates + excluded count note |
| `PORTFOLIO_GOAL_RESEARCH` | Feasibility assessment, qualified candidates, constraints |
| `PORTFOLIO_IMPACT` | Context availability, buying power status, up to 4 candidate impacts, research questions |
| `OPTIONS_RESEARCH` | Strategies list; estimated data → "Estimated Research" alert; live data → shows strike/expiry |

Unknown domains render a safe fallback: "No domain-specific summary available for this record."

### Estimated options behavior
When `record.dataQuality.estimated === true`:
- Shows amber "Estimated Research" alert (labeled clearly)
- Hides live-only fields (`strike`, `expiry`)
- Shows estimated fields with "(approx.)" suffix

---

## 7. Security Controls

| Control | Implementation |
|---|---|
| userId never from client | All routes use `req.session.userId` via `isAuthenticated` |
| No evidence payload from browser | Only `handleId` + user metadata submitted |
| No handle in URL | After save, navigation goes to `/research/:recordId` (UUID), never `/research?handle=…` |
| No handle in localStorage | Component uses React state only; never calls `localStorage.setItem` |
| No sensitive fields rendered | ResearchRecord client type excludes accountId, accessToken, rawPositions, portfolioContextToken |
| 404 for wrong-owner records | Server returns 404 (not 403) — client shows "not found" error |
| Cross-user handles rejected | Server returns 404; client shows error state |

---

## 8. Analytics

Analytics events dispatched as `CustomEvent` on `window`. **No** handle IDs, record IDs, or evidence content included.

| Event | When |
|---|---|
| `research_save_clicked` | User clicks Save Research button |
| `research_save_succeeded` | `POST /api/research-records` returns 201 |
| `research_save_failed` | API returns error |
| `research_record_opened` | User navigates to detail page via library link |
| `research_record_archived` | Archive mutation succeeds |
| `research_record_deleted` | Delete mutation succeeds |

---

## 9. Known Limitations

- **No full-text search over evidence content** — search only covers title, symbol, userLabel, tags. Deep evidence search (reasons, verdict text) is not exposed.
- **No date-range filter in this sprint** — the API supports `generatedAt` filtering but no date picker is in the UI yet.
- **No pagination count on filter change** — total record count resets to 0 briefly on filter change (loading state).
- **No multi-select domain filter** — single domain at a time.
- **Save handle in-process only** — a server restart invalidates pending handles; users see "Snapshot expired" and need to re-run analysis.
- **No handle persistence** — the 10-minute countdown in the button is client-side; if the page is refreshed, the expiry timer is recalculated from the `expiresAt` timestamp.
- **Journal `entered_manually` / `closed_manually` not yet in UI** — the `?manual=true` endpoint exists but the UI currently only exposes basic thesis/notes editing.

---

## 10. Next Research Workspace Step

The next sprint (Research Workspace) would extend the detail page to include:

1. **AI narrative panel** — GPT explanation of the saved evidence (additive, non-blocking; never modifies immutable fields)
2. **Full Decision Journal** — trade-entry form, manual P/L tracking, outcome review
3. **Refresh chains** — "Re-run analysis" action that creates a linked child record
4. **Comparison view** — diff between parent and child evidence records
5. **Export** — PDF / CSV of the evidence + journal entry
6. **Advanced search** — full-text over reasons/verdict using a server-side search index
7. **Broker reconciliation** — optional manual import of fill confirmation (not automatic)
