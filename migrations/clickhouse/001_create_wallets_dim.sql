-- Migration 001: Create wallets_dim table
-- Purpose: Store wallet dimension data (discovery, metadata)

CREATE TABLE IF NOT EXISTS wallets_dim (
  wallet_address String,
  first_seen DateTime,
  last_seen DateTime,
  total_volume_usd Decimal(18, 2),
  total_trades UInt32,
  is_active Boolean,
  created_at DateTime,
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet_address;
