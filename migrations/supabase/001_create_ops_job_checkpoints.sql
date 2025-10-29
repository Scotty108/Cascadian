-- Migration: Create ops_job_checkpoints table
-- Purpose: Track long-running job progress for crash recovery
--
-- Usage:
--   psql $DATABASE_URL -f migrations/supabase/001_create_ops_job_checkpoints.sql

CREATE TABLE IF NOT EXISTS ops_job_checkpoints (
  job TEXT NOT NULL,
  step TEXT NOT NULL,
  batch_idx INTEGER NOT NULL DEFAULT 0,
  pairs_done INTEGER NOT NULL DEFAULT 0,
  last_mutations INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (job, step)
);

-- Add index for querying by updated_at
CREATE INDEX IF NOT EXISTS idx_ops_job_checkpoints_updated_at
  ON ops_job_checkpoints(updated_at DESC);

-- Add comment
COMMENT ON TABLE ops_job_checkpoints IS 'Checkpoint table for long-running enrichment jobs. Enables crash recovery.';

-- Example usage:
--
-- Insert/update checkpoint:
-- INSERT INTO ops_job_checkpoints (job, step, batch_idx, pairs_done, last_mutations, updated_at)
-- VALUES ('enrichment', 'D', 50, 15000, 100, NOW())
-- ON CONFLICT (job, step) DO UPDATE SET
--   batch_idx = EXCLUDED.batch_idx,
--   pairs_done = EXCLUDED.pairs_done,
--   last_mutations = EXCLUDED.last_mutations,
--   updated_at = EXCLUDED.updated_at;
--
-- Query latest checkpoint:
-- SELECT * FROM ops_job_checkpoints WHERE job = 'enrichment' AND step = 'D';
