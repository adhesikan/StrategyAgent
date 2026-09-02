---
name: Historical 13F source retrieval
description: Durable retrieval and classification rules for SEC bulk 13F history.
---

Historical and scheduled 13F ingestion must resolve archive URLs from the official SEC dataset catalog. Never reconstruct post-2023 `YYYYqN` archive paths.

**Why:** Published date-range archives can coexist with HTML 404 responses at guessed legacy paths; treating those responses as unpublished erased usable historical depth.

**How to apply:** Preserve safe HTTP metadata, reject redirects/HTML/zero-byte/wrong-MIME/malformed ZIP responses fail-closed, and incrementally verify each streamed entry's central-directory CRC and uncompressed size. Integrity failures are never partial success.