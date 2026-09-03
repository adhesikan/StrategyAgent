CREATE TABLE IF NOT EXISTS institutional_replay_validation_checkpoints (
  canonical_accession TEXT PRIMARY KEY,
  metadata_fingerprint TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALID', 'FAILED')),
  source_url TEXT,
  source_checksum TEXT,
  holding_count INTEGER,
  failure_reason TEXT,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'VALID' AND source_url IS NOT NULL AND source_checksum IS NOT NULL
    AND holding_count IS NOT NULL AND holding_count > 0) OR status = 'FAILED'),
  CHECK (failure_reason IS NULL OR length(failure_reason) <= 100)
);
CREATE INDEX IF NOT EXISTS idx_institutional_replay_validation_status
  ON institutional_replay_validation_checkpoints (status);