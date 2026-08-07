-- Sprint 2.2.6 — Institutional Signal Engine schema migration
-- Additive and idempotent — safe to run multiple times.
-- Run after migrate-security-master.sql and migrate-institutional.sql.

-- ── institutional_symbol_signals ─────────────────────────────────────────────
-- Pre-computed institutional signal per ticker symbol.
-- Populated by rebuildInstitutionalSignals() / rebuildInstitutionalSignalForSymbol().
-- The API reads from this table — never from raw holdings at request time.
-- One row per symbol; upserted on every rebuild.

CREATE TABLE IF NOT EXISTS institutional_symbol_signals (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol                 TEXT        NOT NULL,

  -- Signal envelope
  status                 TEXT        NOT NULL DEFAULT 'unavailable',
  latest_quarter         TEXT,
  previous_quarter       TEXT,
  period_end_date        DATE,

  -- Score and label
  score                  INTEGER,
  label                  TEXT,
  summary                TEXT,

  -- Manager activity counts
  manager_count_latest   INTEGER,
  manager_count_previous INTEGER,
  total_shares_latest    BIGINT,
  total_shares_previous  BIGINT,
  total_value_latest     BIGINT,
  total_value_previous   BIGINT,
  new_manager_count      INTEGER     NOT NULL DEFAULT 0,
  exited_manager_count   INTEGER     NOT NULL DEFAULT 0,
  increased_manager_count INTEGER    NOT NULL DEFAULT 0,
  reduced_manager_count  INTEGER     NOT NULL DEFAULT 0,
  unchanged_manager_count INTEGER    NOT NULL DEFAULT 0,

  -- Concentration
  top_holder_pct         REAL,
  top5_holder_pct        REAL,
  concentration_trend    TEXT,

  -- Data quality
  mapping_coverage       REAL,
  data_quality_confidence TEXT,

  -- Bounded change lists (JSON arrays of InstitutionalManagerChange)
  top_buyers             JSONB       NOT NULL DEFAULT '[]',
  top_sellers            JSONB       NOT NULL DEFAULT '[]',
  new_positions          JSONB       NOT NULL DEFAULT '[]',
  exited_positions       JSONB       NOT NULL DEFAULT '[]',

  -- Score components (JSON object)
  score_components       JSONB,

  calculated_at          TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_iss_symbol UNIQUE (symbol)
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_iss_symbol     ON institutional_symbol_signals (symbol);
CREATE INDEX IF NOT EXISTS idx_iss_score      ON institutional_symbol_signals (score);
CREATE INDEX IF NOT EXISTS idx_iss_status     ON institutional_symbol_signals (status);
CREATE INDEX IF NOT EXISTS idx_iss_calculated ON institutional_symbol_signals (calculated_at);
CREATE INDEX IF NOT EXISTS idx_iss_label      ON institutional_symbol_signals (label);
