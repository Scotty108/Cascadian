-- Wallet Resolution Outcomes Table
-- Tracks "conviction accuracy" - whether a wallet held the winning side at resolution
-- This is distinct from P&L (which rewards trading) - this rewards prediction accuracy

CREATE TABLE IF NOT EXISTS wallet_resolution_outcomes (
    wallet_address String,
    condition_id String,
    market_id String,
    resolved_outcome String,        -- "YES" / "NO" / outcome index
    final_side String,              -- What side wallet held at resolution
    won UInt8,                      -- 1 if final_side matched resolved_outcome, 0 otherwise
    resolved_at DateTime,
    canonical_category String,
    num_trades UInt32,              -- How many trades went into this position
    final_shares Float64,           -- Net shares held at resolution (for debugging)
    ingested_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (wallet_address, condition_id);
