-- Sprint 2.6.5 — Research Goals & Research Planning
-- Creates the research_goals table for user research preferences.
--
-- IMPORTANT: All preference data. This table stores research focus only.
-- No suitability, risk tolerance, or financial questionnaire data.

CREATE TABLE IF NOT EXISTS research_goals (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   VARCHAR NOT NULL,
  name                      TEXT NOT NULL,
  goal_type                 TEXT NOT NULL DEFAULT 'custom',
  description               TEXT,
  horizon                   TEXT NOT NULL DEFAULT 'long_term',
  research_style            TEXT NOT NULL DEFAULT 'balanced',
  focus_areas               JSONB NOT NULL DEFAULT '[]',
  preferred_sectors         JSONB NOT NULL DEFAULT '[]',
  preferred_themes          JSONB NOT NULL DEFAULT '[]',
  preferred_opportunity_types JSONB NOT NULL DEFAULT '[]',
  volatility_preference     TEXT NOT NULL DEFAULT 'balanced',
  options_interest          BOOLEAN NOT NULL DEFAULT FALSE,
  monitoring_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary                BOOLEAN NOT NULL DEFAULT FALSE,
  status                    TEXT NOT NULL DEFAULT 'active',
  created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rg_user_id        ON research_goals (user_id);
CREATE INDEX IF NOT EXISTS idx_rg_user_status    ON research_goals (user_id, status);
CREATE INDEX IF NOT EXISTS idx_rg_user_primary   ON research_goals (user_id, is_primary) WHERE is_primary = TRUE;

-- Verify
SELECT COUNT(*) AS research_goals_count FROM research_goals;
