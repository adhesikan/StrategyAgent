---
name: Options-context trust boundary
description: How MCP gets live option-chain access without ever seeing broker tokens.
---
- MCP never receives broker OAuth tokens. It gets a short-lived (5 min, revoked after each Ask) opaque context token minted server-side, and calls back into /api/internal/options/* with VCP_INTERNAL_API_KEY + X-Options-Context. VCP Trader resolves the user and fetches chains via the existing broker layer (which owns refresh).
- MCP responses are untrusted: everything from scan/build tools is passed through a recursive key-scrubber (drops token/secret/credential-looking keys) at the trust boundary before storage in cards/LLM payloads.
- The context store is in-memory (hash-keyed). Multi-instance deploys would need sticky routing or a shared store — a known limitation, acceptable on single-instance Railway.
**Why:** review round found unsanitized MCP passthrough could leak an echoed token to browser/LLM; scrubbing at the boundary beats trusting the remote service.
**How to apply:** any new MCP tool whose args carry a capability token, or any new field surfaced from MCP responses.
