-- Sprint 2.8.1A — Trade Preferences & User-Directed Expression Selection
-- Additive only. Safe to run on fresh or existing DB.

-- 1. Add trading preference columns to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS preferred_expression_types JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS show_other_compatible_structures BOOLEAN DEFAULT true;

-- 2. Add broad expression type to trade_planning_sessions
ALTER TABLE trade_planning_sessions
  ADD COLUMN IF NOT EXISTS broad_expression_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expression_selected_by TEXT DEFAULT NULL;

-- 3. Add broad expression type to trade_plans
ALTER TABLE trade_plans
  ADD COLUMN IF NOT EXISTS broad_expression_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expression_selected_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expression_selected_at TIMESTAMPTZ DEFAULT NULL;

-- 4. Index for looking up sessions by broad expression type
CREATE INDEX IF NOT EXISTS idx_tps_broad_expression
  ON trade_planning_sessions (user_id, broad_expression_type)
  WHERE broad_expression_type IS NOT NULL;
