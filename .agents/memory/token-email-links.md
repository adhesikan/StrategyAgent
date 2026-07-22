---
name: Security-token email links
description: How to build base URLs for password-reset / email-verification links safely
---

Rule: links containing security tokens (password reset, email verification) must use a trusted canonical origin — `APP_BASE_URL` env, falling back to the first `REPLIT_DOMAINS` entry or `REPLIT_DEV_DOMAIN` — never `Host`/`X-Forwarded-Host` request headers.

**Why:** header-derived base URLs enable host-header poisoning: an attacker submits forgot-password with a forged host and the emailed reset link points at their domain, leaking a valid token. Flagged as a serious issue in architect review.

**How to apply:** any new email that embeds a token or magic link. Also keep forgot-password responses uniform 200 even when rate-limited (throttle silently) so throttling doesn't create an enumeration/probing signal.
