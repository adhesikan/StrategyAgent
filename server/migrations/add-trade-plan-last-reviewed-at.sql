-- Sprint 2.8.6A Defect-9: Explicit research review acknowledgement
--
-- Adds last_reviewed_at to trade_plans.
-- When set and within 7 days, the REQUIRES_REVIEW lifecycle state is cleared
-- by the user's explicit review acknowledgement.
-- THESIS_INVALIDATED and DATA_STALE always take priority and cannot be cleared.
--
-- Idempotent: safe to run multiple times.
-- Additive only: no data deleted, no columns altered.

ALTER TABLE trade_plans
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

-- Verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_plans' AND column_name = 'last_reviewed_at'
  ) THEN
    RAISE EXCEPTION 'Migration failed: last_reviewed_at column not found in trade_plans';
  END IF;
  RAISE NOTICE 'Migration OK: trade_plans.last_reviewed_at exists';
END $$;
