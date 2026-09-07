-- Frozen replay-validation manifest (deterministic convergence authorization).
-- Additive only. Does not modify or delete institutional_replay_validation_checkpoints.

CREATE TABLE IF NOT EXISTS institutional_replay_validation_runs (
  id                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  validator_version  TEXT        NOT NULL,
  candidate_set_hash TEXT        NOT NULL,
  status             TEXT        NOT NULL CHECK (status IN ('COMPLETE', 'INCOMPLETE', 'FAILED')),
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'COMPLETE' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_institutional_replay_run_version_status
  ON institutional_replay_validation_runs (validator_version, status, completed_at DESC);

CREATE TABLE IF NOT EXISTS institutional_replay_validation_run_items (
  id                          TEXT    PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id                      TEXT    NOT NULL
    REFERENCES institutional_replay_validation_runs(id) ON DELETE CASCADE,
  canonical_accession         TEXT    NOT NULL,
  metadata_fingerprint        TEXT    NOT NULL,
  filer_cik                   TEXT    NOT NULL,
  filing_date                 TEXT    NOT NULL,
  period_of_report            TEXT    NOT NULL,
  filing_type                 TEXT    NOT NULL,
  amendment_flag              BOOLEAN NOT NULL,
  source_url                  TEXT    NOT NULL,
  source_checksum             TEXT    NOT NULL,
  holding_count               INTEGER NOT NULL CHECK (holding_count > 0),
  stored_holdings_fingerprint TEXT    NOT NULL,
  UNIQUE (run_id, canonical_accession)
);
