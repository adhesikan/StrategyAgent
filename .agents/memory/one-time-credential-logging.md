---
name: One-time credential response logging
description: Project-wide rule for endpoints that return a newly created secret exactly once.
---

Any endpoint that returns a one-time credential must redact the credential at the global response-body logging boundary as well as excluding it from persistence and later API responses.

**Why:** The application logger captures JSON response bodies. A creation route can correctly hash the credential in storage and still leak the raw value through routine response logging.

**How to apply:** When adding any future secret-creation flow, extend the central log sanitizer and add a regression assertion that the serialized log-safe response contains no raw credential.