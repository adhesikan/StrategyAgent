-- Sprint 2.6.4 — Research Workspace v2 context metadata columns
-- Adds 5 nullable columns to workspace_conversations for context tracking.
-- Backward compatible: all columns are nullable with no defaults required.

ALTER TABLE workspace_conversations
  ADD COLUMN IF NOT EXISTS context_type    TEXT,
  ADD COLUMN IF NOT EXISTS context_label   TEXT,
  ADD COLUMN IF NOT EXISTS primary_symbol  VARCHAR,
  ADD COLUMN IF NOT EXISTS comparison_symbols TEXT[],
  ADD COLUMN IF NOT EXISTS source_route    VARCHAR;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'workspace_conversations'
  AND column_name IN ('context_type','context_label','primary_symbol','comparison_symbols','source_route')
ORDER BY column_name;
