# MCP Client Session Recovery

## Root Cause

The Railway MCP service maintains **stateful Streamable-HTTP sessions**. When the service
redeploys or restarts, all in-progress sessions are discarded server-side. VCP Trader cached
the old session internally and reused it on the next tool call. The MCP service responded with
**HTTP 404** and the message `MCP session not found — client must re-initialize`. Because
`normalizeMcpError()` had no classifier for that pattern, it fell through to the generic
`MCP_TOOL_ERROR` code, which is never automatically retried. The dashboard `Stock Opportunities`
section showed "temporarily unavailable" until the server process was manually restarted.

---

## Current Session Lifecycle

| Stage | Where |
|---|---|
| Session created | `McpToolsClient.ensureClient()` — lazy, on first tool call |
| Session stored | `McpToolsClient.client` — module-level singleton (`server/mcp/client.ts`) |
| Session shared | All backend requests share the same session (one per process) |
| Session cleared on close | `client.onclose` callback nulls `this.client` |
| Session cleared on error | `resetSession()` — nulls `this.client`, best-effort closes old transport |
| Recovery deduplication | `this.recovering: Promise<void> | null` — concurrent callers join one reinit |
| Connect deduplication | `this.connecting: Promise<SdkClient> | null` — prevents multiple simultaneous connects |

---

## Invalid-Session Classifier

**`isMcpSessionInvalid(err)`** in `server/mcp/errors.ts`:

```
HTTP 404 in error message
  AND
one of:
  "session not found"
  "must re-initialize" / "must reinitialize"
  "reinitializ…"
  "session invalid"
  "session expired"
```

Only this narrow combination produces `MCP_SESSION_INVALID`. All other 404s (unknown route,
tool not found, ordinary application 404) fall through to `MCP_TOOL_ERROR` as before.

### What is NOT classified as session-invalid

| Response | Code |
|---|---|
| HTTP 401 / 403 | `MCP_AUTH_ERROR` — not retried, not recovered |
| HTTP 404 without session text | `MCP_TOOL_ERROR` — not retried |
| timeout / abort | `MCP_TIMEOUT` — retried only for fast tools |
| ECONNREFUSED / network | `MCP_UNAVAILABLE` — retried with reconnect |
| provider failure (429, tool error body) | `MCP_TOOL_ERROR` — not retried |
| schema / malformed | `MCP_TOOL_ERROR` — not retried |

---

## One-Retry Policy

1. Attempt 1 of `callTool()` fails → `normalizeMcpError()` returns `MCP_SESSION_INVALID`.
2. Tool must be in `SESSION_RECOVERY_ALLOWLIST` (read-only tools only).
3. `sessionRecoveryAttempted` guard prevents a second recovery on the same call.
4. `recoverSession()` is called — clears stale session, reinitializes, awaits new session.
5. Attempt 2 runs with the fresh session and the **remaining deadline budget**.
6. If attempt 2 fails for any reason (including another session error), the error is surfaced.
   No further retries are attempted.

---

## Read-Only Allowlist (`SESSION_RECOVERY_ALLOWLIST`)

Only tools verified as **side-effect-free** are eligible for automatic session-recovery retry.
Tools that could produce duplicate writes or side effects must opt in explicitly.

**Allowlisted (auto-retry safe):**

```
get_quote               get_market_history      get_news
scan_vcp                get_positions           scan_strategy
scan_opportunities      build_trade_candidate   calculate_position_risk
get_market_regime       get_earnings            get_fundamentals
get_options_chain       analyze_options         select_option_contracts
calculate_trade_risk    recommend_trade_strategy  rank_market_trade_candidates
plan_portfolio_trade
```

**Excluded from auto-retry:**

| Tool | Reason |
|---|---|
| `prepare_trade_ticket` | Triggered by explicit user action; should fail visibly so the user can retry intentionally |

---

## Concurrent Reinitialization

`recoverSession()` uses a shared `this.recovering: Promise<void> | null` field:

1. **First caller** sees `this.recovering === null` → creates the recovery promise, assigns it.
   Logs `mcp_session_reinitialize_started`.
2. **Concurrent callers** see `this.recovering !== null` → await the same promise.
   Log `mcp_session_reinitialize_joined`.
3. Recovery promise resolves → `this.recovering = null` (via `finally`). All waiting callers
   proceed to retry their original tool call.
4. Recovery promise rejects → `this.recovering = null` (via `finally`). All waiting callers
   receive the rejection. A later independent request will start a fresh recovery.
5. `ensureClient()` itself deduplicates concurrent connection attempts with `this.connecting`.

**No deadlock is possible:** the recovery promise always completes (resolves or rejects) and
always clears `this.recovering` in `finally`. No caller holds a lock that blocks recovery.

---

## Timeout Budget

One overall deadline is established at the start of `callTool()`:

```
deadline = Date.now() + timeoutMs
```

Before starting the session-recovery retry:
- `remaining = deadline - Date.now()`
- If `remaining < MIN_VIABLE_RETRY_MS (500ms)` → skip retry, surface the session error.

The retry SDK call uses `Math.min(timeoutMs, Math.max(MIN_VIABLE_RETRY_MS, remaining))` as its
timeout, so the session initialization + retry remains within the original outer timeout.

**Known limitation:** `ensureClient()` (connection phase) uses `cfg.timeoutMs` internally and
does not subtract time already spent. In practice the connect timeout is 10 s and
`MIN_VIABLE_RETRY_MS` is 500 ms, so the total budget remains bounded in all realistic cases.

---

## Railway Restart Behavior

Sequence after a Railway MCP deployment:

1. Railway restarts the service → all sessions discarded.
2. VCP Trader backend sends next tool call with stale session ID.
3. MCP returns `HTTP 404: session not found — client must re-initialize`.
4. VCP Trader detects `MCP_SESSION_INVALID`, calls `recoverSession()`.
5. `recoverSession()` calls `resetSession()` (clears old client), then `ensureClient()` (new
   connection + initialization).
6. Retry executes with the fresh session — succeeds transparently.
7. Dashboard loads normally; user sees no error.

Concurrent requests during the restart window: only one reinitialization occurs; others join it
and retry once it completes.

---

## Observability

Structured JSON events logged to stdout/stderr (never containing session IDs, tokens, payloads,
or user data):

| Event | When |
|---|---|
| `mcp_session_invalid_detected` | Session-invalid error classified on a retryable tool |
| `mcp_session_reinitialize_started` | This caller is creating a fresh session |
| `mcp_session_reinitialize_joined` | This caller joined an in-progress reinitialization |
| `mcp_session_reinitialize_succeeded` | Fresh session established successfully |
| `mcp_session_reinitialize_failed` | Reinitialization could not establish a session |
| `mcp_tool_retried_after_reinitialize` | Tool call retried with the fresh session |
| `mcp_tool_retry_failed` | Retry after reinitialization also failed |

Fields in each event: `event`, `tool`, `attempt`, `durationMs` (where applicable), `code`
(where applicable), `success` (where applicable).

---

## Dashboard Failure Behavior

| Outcome | Dashboard behavior |
|---|---|
| Recovery succeeds | `Stock Opportunities` loads normally; user sees no error |
| Recovery fails | `Stock Opportunities` shows "temporarily unavailable" (isolated section) |
| Recovery fails | `Market Snapshot`, `AI Infrastructure Watch` are unaffected |
| Recovery fails | No simulated/mock fallback data is shown |
| Recovery fails | MCP session details are never exposed to the client |

---

## Known Limitations

1. `ensureClient()` connect timeout is not reduced by time already spent in the first attempt.
   Under normal Railway restart conditions (< 5 s) this does not matter.

2. `prepare_trade_ticket` is excluded from auto-retry. It is user-action-triggered and will
   surface a failure the user can manually retry.

3. The recovery allowlist is maintained alongside `MCP_ALLOWED_TOOLS` in `tools.ts`. If a new
   read-only tool is added to the allowlist, add it to `SESSION_RECOVERY_ALLOWLIST` in
   `client.ts` if it is side-effect-free.

4. `listTools()` does not participate in session recovery — a stale session during `listTools()`
   will fail. The `/mcp/status` route handles this gracefully (returns cached tool names).
