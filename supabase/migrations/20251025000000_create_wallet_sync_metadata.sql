-- Wallet Sync Metadata Table
-- Tracks the sync status and progress for wallet trade synchronization to ClickHouse
-- This enables incremental syncs and monitoring of bulk sync operations

CREATE TABLE IF NOT EXISTS wallet_sync_metadata (
  wallet_address TEXT PRIMARY KEY,

  -- Sync status tracking
  sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'syncing', 'completed', 'failed', 'skipped')),

  -- Progress metrics
  total_trades_synced INTEGER DEFAULT 0,
  total_trades_processed INTEGER DEFAULT 0, -- Raw events from Goldsky
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  error_count INTEGER DEFAULT 0,

  -- Sync efficiency metrics
  sync_duration_ms INTEGER, -- How long the last sync took
  trades_per_second DECIMAL(10, 2),

  -- Incremental sync support
  last_trade_timestamp TIMESTAMPTZ, -- Timestamp of most recent trade synced
  needs_resync BOOLEAN DEFAULT FALSE, -- Flag for forcing full resync

  -- Metadata
  sync_version TEXT DEFAULT '1.0', -- Version of sync logic used
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_wallet_sync_metadata_status ON wallet_sync_metadata(sync_status);
CREATE INDEX IF NOT EXISTS idx_wallet_sync_metadata_last_synced ON wallet_sync_metadata(last_synced_at DESC)
  WHERE sync_status = 'completed';
CREATE INDEX IF NOT EXISTS idx_wallet_sync_metadata_needs_resync ON wallet_sync_metadata(needs_resync)
  WHERE needs_resync = TRUE;
CREATE INDEX IF NOT EXISTS idx_wallet_sync_metadata_failed ON wallet_sync_metadata(sync_status, error_count DESC)
  WHERE sync_status = 'failed';

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_wallet_sync_metadata_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_wallet_sync_metadata_updated_at_trigger ON wallet_sync_metadata;
CREATE TRIGGER update_wallet_sync_metadata_updated_at_trigger
  BEFORE UPDATE ON wallet_sync_metadata
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_sync_metadata_updated_at();

-- View for monitoring sync progress
CREATE OR REPLACE VIEW wallet_sync_progress AS
SELECT
  sync_status,
  COUNT(*) as wallet_count,
  SUM(total_trades_synced) as total_trades,
  AVG(total_trades_synced) as avg_trades_per_wallet,
  MAX(last_synced_at) as latest_sync,
  AVG(sync_duration_ms / 1000.0) as avg_sync_seconds
FROM wallet_sync_metadata
GROUP BY sync_status
ORDER BY
  CASE sync_status
    WHEN 'completed' THEN 1
    WHEN 'syncing' THEN 2
    WHEN 'pending' THEN 3
    WHEN 'failed' THEN 4
    WHEN 'skipped' THEN 5
  END;

-- View for identifying wallets needing sync (from wallet_scores)
CREATE OR REPLACE VIEW wallet_scores_needing_sync AS
SELECT
  w.wallet_address,
  w.omega_ratio,
  w.total_positions,
  COALESCE(s.sync_status, 'pending') as sync_status,
  s.last_synced_at,
  s.last_error,
  s.error_count,
  -- Priority score (higher = should sync sooner)
  CASE
    WHEN s.sync_status = 'failed' AND s.error_count < 3 THEN 100
    WHEN s.sync_status IS NULL OR s.sync_status = 'pending' THEN 50
    WHEN s.needs_resync = TRUE THEN 75
    WHEN s.last_synced_at IS NULL THEN 60
    WHEN s.last_synced_at < NOW() - INTERVAL '7 days' THEN 40
    WHEN s.last_synced_at < NOW() - INTERVAL '30 days' THEN 30
    ELSE 10
  END as sync_priority
FROM wallet_scores w
LEFT JOIN wallet_sync_metadata s ON w.wallet_address = s.wallet_address
WHERE
  s.sync_status IS NULL
  OR s.sync_status IN ('pending', 'failed')
  OR s.needs_resync = TRUE
  OR s.last_synced_at < NOW() - INTERVAL '7 days'
ORDER BY sync_priority DESC, w.omega_ratio DESC NULLS LAST;

-- Comments
COMMENT ON TABLE wallet_sync_metadata IS 'Tracks sync status for wallet trades to ClickHouse, enabling incremental updates and monitoring';
COMMENT ON COLUMN wallet_sync_metadata.sync_status IS 'Current status: pending (not started), syncing (in progress), completed (success), failed (error), skipped (intentionally skipped)';
COMMENT ON COLUMN wallet_sync_metadata.total_trades_synced IS 'Number of trades successfully inserted into ClickHouse';
COMMENT ON COLUMN wallet_sync_metadata.total_trades_processed IS 'Total raw OrderFilledEvents fetched from Goldsky (includes USDC-only trades)';
COMMENT ON COLUMN wallet_sync_metadata.last_trade_timestamp IS 'Timestamp of the most recent trade synced (for incremental updates)';
COMMENT ON COLUMN wallet_sync_metadata.needs_resync IS 'Force a full resync on next run (e.g., if sync logic changed)';
COMMENT ON COLUMN wallet_sync_metadata.sync_version IS 'Version of sync script used (for tracking schema/logic changes)';

COMMENT ON VIEW wallet_sync_progress IS 'Aggregated view of sync progress across all wallets';
COMMENT ON VIEW wallet_scores_needing_sync IS 'Prioritized list of wallets from wallet_scores that need to be synced or resynced';
