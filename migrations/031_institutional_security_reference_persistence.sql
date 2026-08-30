-- Canonical OpenFIGI lookup state and normalized candidate history.
-- Idempotent: no provider response bodies are persisted.
BEGIN;

CREATE TABLE IF NOT EXISTS institutional_security_lookup_states (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider TEXT NOT NULL, cusip TEXT NOT NULL, provider_outcome TEXT NOT NULL, outcome TEXT NOT NULL,
  resolved_symbol TEXT, candidate_count INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL, error_code TEXT, retry_after_at TIMESTAMP,
  first_observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_observed_at TIMESTAMP NOT NULL DEFAULT NOW(), provenance TEXT NOT NULL,
  CONSTRAINT institutional_security_lookup_states_provider_cusip_unique UNIQUE (provider, cusip)
);
CREATE INDEX IF NOT EXISTS idx_iss_lookup_outcome ON institutional_security_lookup_states (outcome, last_observed_at);
CREATE INDEX IF NOT EXISTS idx_iss_lookup_retry ON institutional_security_lookup_states (retry_after_at);
ALTER TABLE institutional_security_lookup_states ADD COLUMN IF NOT EXISTS provider_outcome TEXT;
UPDATE institutional_security_lookup_states SET provider_outcome = outcome WHERE provider_outcome IS NULL;
ALTER TABLE institutional_security_lookup_states ALTER COLUMN provider_outcome SET NOT NULL;

CREATE TABLE IF NOT EXISTS institutional_security_candidate_observations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider TEXT NOT NULL, cusip TEXT NOT NULL, figi TEXT, composite_figi TEXT,
  share_class_figi TEXT, ticker TEXT, name TEXT, exchange_code TEXT,
  market_sector TEXT, security_type TEXT, security_type2 TEXT,
  supported BOOLEAN NOT NULL DEFAULT FALSE, candidate_fingerprint TEXT NOT NULL,
  first_observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_observed_at TIMESTAMP NOT NULL DEFAULT NOW(), is_current BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMP, valid_to TIMESTAMP, relationship TEXT,
  CONSTRAINT institutional_security_candidate_provider_cusip_fp_unique
    UNIQUE (provider, cusip, candidate_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_iss_candidate_current
  ON institutional_security_candidate_observations (provider, cusip, is_current);
CREATE INDEX IF NOT EXISTS idx_iss_candidate_ticker
  ON institutional_security_candidate_observations (ticker);
COMMIT;