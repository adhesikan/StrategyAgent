---
name: External consumer proxy boundary
description: Security rules for server-side proxies that hold a privileged StockMetrics API key for browser consumers.
---

An external-consumer proxy must use a separate query allowlist for each upstream route, including an empty allowlist for detail routes that accept only a path symbol. Reject duplicate and blank scalar parameters, then rebuild the upstream query only from normalized validated values.

**Why:** Copying the browser query through after partial validation leaves parameter-pollution behavior to the upstream parser, and applying a collection-route schema to a detail route silently expands that detail route's contract.

**How to apply:** For every browser-to-StockMetrics proxy, validate method, exact route, symbol, and every query occurrence before constructing a new upstream URL. Keep one deadline active through both response headers and body parsing so a stalled JSON body cannot hold the proxy open.