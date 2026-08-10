-- Sprint 2.7.0: Trade Planning Foundation
-- Creates trade_planning_sessions table for persisting user planning sessions.
--
-- Sessions store user-selected planning constraints and selected expression family.
-- They do NOT store orders, broker instructions, or authoritative research data.
-- Server always reconstructs authoritative context from canonical services.
--
-- Note: research_goal_id stored as TEXT (matching research_goals.id which is varchar).

CREATE TABLE IF NOT EXISTS trade_planning_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   TEXT NOT NULL,
  symbol                    VARCHAR(20) NOT NULL,
  opportunity_id            TEXT,
  research_goal_id          TEXT,
  portfolio_id              UUID,
  -- User-selected planning constraints (JSONB, never includes income/net-worth/age)
  constraints               JSONB NOT NULL DEFAULT '{"equityAllowed":true,"optionsAllowed":false}',
  -- Selected expression family (user's current focus area in the session)
  selected_expression_family TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tps_user_id
  ON trade_planning_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_tps_user_symbol
  ON trade_planning_sessions (user_id, symbol);

CREATE INDEX IF NOT EXISTS idx_tps_updated
  ON trade_planning_sessions (updated_at DESC);

-- Constraint: selected_expression_family must be a known value when set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'trade_planning_sessions'
      AND constraint_name = 'chk_expression_family'
  ) THEN
    ALTER TABLE trade_planning_sessions
      ADD CONSTRAINT chk_expression_family
      CHECK (
        selected_expression_family IS NULL
        OR selected_expression_family IN (
          'equity', 'equity_scaled', 'income', 'defined_risk_directional',
          'covered_call', 'cash_secured_put', 'vertical_spread',
          'long_option', 'neutral_options', 'monitor_only'
        )
      );
  END IF;
END $$;
