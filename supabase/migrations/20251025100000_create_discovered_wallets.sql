-- Discovered Wallets Table
-- Stores ALL discovered wallet addresses from multiple sources
-- This is the master registry of all Polymarket wallets we know about

CREATE TABLE IF NOT EXISTS discovered_wallets (
  wallet_address TEXT PRIMARY KEY,
  discovery_sources TEXT[] NOT NULL DEFAULT '{}', -- ['pnl_subgraph', 'markets_db', 'activity_subgraph']
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  needs_sync BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  sync_attempts INTEGER DEFAULT 0,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_discovered_wallets_needs_sync
  ON discovered_wallets(needs_sync)
  WHERE needs_sync = TRUE;

CREATE INDEX IF NOT EXISTS idx_discovered_wallets_last_synced
  ON discovered_wallets(last_synced_at);

CREATE INDEX IF NOT EXISTS idx_discovered_wallets_sources
  ON discovered_wallets USING GIN(discovery_sources);

-- Updated trigger
CREATE OR REPLACE FUNCTION update_discovered_wallets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_discovered_wallets_updated_at ON discovered_wallets;
CREATE TRIGGER trigger_discovered_wallets_updated_at
  BEFORE UPDATE ON discovered_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_discovered_wallets_updated_at();

-- View: Wallets needing sync (priority queue)
DROP VIEW IF EXISTS wallets_needing_sync;
CREATE OR REPLACE VIEW wallets_needing_sync AS
SELECT
  wallet_address,
  discovery_sources,
  discovered_at,
  last_synced_at,
  sync_attempts,
  -- Priority score: never synced = highest, old sync = medium, recently synced = low
  CASE
    WHEN last_synced_at IS NULL THEN 1000 -- Never synced
    WHEN last_synced_at < NOW() - INTERVAL '7 days' THEN 500 -- Stale (weekly refresh)
    WHEN last_synced_at < NOW() - INTERVAL '1 day' THEN 100 -- Old (daily refresh)
    ELSE 10 -- Recently synced
  END as priority_score
FROM discovered_wallets
WHERE needs_sync = TRUE
  AND (sync_attempts < 3 OR sync_attempts IS NULL) -- Skip wallets with 3+ failed attempts
ORDER BY priority_score DESC, discovered_at ASC;

-- View: Discovery statistics
CREATE OR REPLACE VIEW discovery_stats AS
SELECT
  COUNT(*) as total_wallets,
  COUNT(*) FILTER (WHERE needs_sync = TRUE) as needs_sync,
  COUNT(*) FILTER (WHERE last_synced_at IS NOT NULL) as synced,
  COUNT(*) FILTER (WHERE last_synced_at IS NULL) as never_synced,
  COUNT(*) FILTER (WHERE last_synced_at < NOW() - INTERVAL '7 days') as stale,
  COUNT(*) FILTER (WHERE array_length(discovery_sources, 1) > 1) as multi_source,
  COUNT(*) FILTER (WHERE sync_error IS NOT NULL) as with_errors
FROM discovered_wallets;

-- View: Wallets by source
CREATE OR REPLACE VIEW wallets_by_source AS
SELECT
  unnest(discovery_sources) as source,
  COUNT(*) as wallet_count
FROM discovered_wallets
GROUP BY source
ORDER BY wallet_count DESC;

-- Comments
COMMENT ON TABLE discovered_wallets IS 'Master registry of all discovered Polymarket wallet addresses from multiple sources';
COMMENT ON COLUMN discovered_wallets.discovery_sources IS 'Array of sources where this wallet was found (pnl_subgraph, markets_db, activity_subgraph, etc.)';
COMMENT ON COLUMN discovered_wallets.needs_sync IS 'TRUE if wallet needs historical trades synced to ClickHouse';
COMMENT ON COLUMN discovered_wallets.sync_attempts IS 'Number of times we attempted to sync this wallet';
COMMENT ON VIEW wallets_needing_sync IS 'Priority queue of wallets that need syncing, ordered by priority';
COMMENT ON VIEW discovery_stats IS 'Summary statistics of wallet discovery and sync status';
COMMENT ON VIEW wallets_by_source IS 'Breakdown of wallets by discovery source';
