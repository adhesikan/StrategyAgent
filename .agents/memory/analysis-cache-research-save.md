---
name: Analysis result cache researchSave strip
description: storeAnalysisResult must strip researchSave handles before caching — they are single-use and user-bound.
---

## Rule
`storeAnalysisResult` in `analysis-result-cache.ts` destructures `researchSave` out of the result before constructing the cache entry. The handle is never stored and therefore can never be replayed via a cache hit.

## Why
The design comment said "No researchSave handles" but the original implementation stored the full result object as-is. A test catching this was in `analysis-cache.test.ts` with a wrong import path, so it never ran. Fixed in Sprint 1 Final Closure Gate.

## How to apply
Any new cache that stores `SafeAskResult` (or similar ask-response objects) must strip single-use handles at write time, not only at read time.
