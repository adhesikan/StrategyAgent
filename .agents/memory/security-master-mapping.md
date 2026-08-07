---
name: Security Master Mapping Engine
description: CUSIP → ticker mapping engine architecture, priority order, confidence scale, and review workflow contract
---

## Priority order (highest → lowest)
1. `security_master` reviewed entry (confidence 100) — never overwritten by automation
2. `institutionalSecurityMappings` exact/reviewed (confidence 95) — cusip_exact method
3. FIGI exact match across security_master reviewed entries (confidence 90)
4. Issuer name deterministic match — unique normalized name match (confidence 80, needs_review)
5. Unmapped queue (confidence 0)

## Confidence scale
- 100 = REVIEWED (manual human confirmation)
- 95 = EXACT (legacy mapping table match)
- 90 = FIGI_EXACT
- 80 = NAME_MATCH (deterministic, unique)
- 60 = PROBABLE (heuristic)
- 0 = UNMAPPED

## Two-table architecture
- `institutionalSecurityMappings` — ingestion-pipeline cache; read by mapping-service.ts
- `security_master` — enriched review queue; richer metadata (exchange, assetType, holdingCount, confidence)
- Approving a mapping in security_master syncs it back to institutionalSecurityMappings

**Why:** Ingestion pipeline must not be modified (Sprint constraint). security_master is the new review-side store; approved entries propagate to the ingestion side.

## Review workflow
- approve(cusip, ticker) → reviewStatus=reviewed, confidence=100, syncs to institutionalSecurityMappings
- reject(cusip) → reviewStatus=rejected, ticker=null
- merge(fromCusip, intoCusip) → fromCusip inherits intoCusip's ticker; intoCusip must be reviewed

## Key constraint
Never overwrite reviewStatus=reviewed via automation. The ON CONFLICT upsert uses a WHERE clause gating on reviewStatus != 'reviewed'.

## Migration
Run `scripts/migrate-security-master.sql` before enabling the mapping pipeline.
