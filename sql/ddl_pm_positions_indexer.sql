-- pm_positions_indexer: Global Polymarket Positions from Goldsky PNL Subgraph
--
-- Purpose: Store UserPosition entities from Polymarket PNL subgraph for global coverage
-- Source: Goldsky-hosted PNL Subgraph v0.0.14
-- Endpoint: https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn
--
-- Schema Version: 1.0
-- Created: 2025-11-15
-- Author: C1

CREATE TABLE IF NOT EXISTS pm_positions_indexer
(
    -- Primary Composite Key (user-tokenId from subgraph)
    composite_id           String,                 -- Format: "{user}-{tokenId}" (GraphQL ID field)

    -- Core Position Fields (from UserPosition entity)
    wallet_address         String,                 -- Wallet address (40 char hex, lowercase)
    token_id               String,                 -- Outcome token ID (256-bit as hex string, 64 chars)
    amount                 Decimal128(18),         -- Current position size (net shares, 18 decimals)
    avg_price              Decimal64(6),           -- Volume-weighted avg entry price (6 decimals, 0-1000000 = 0.00-1.00)
    realized_pnl           Decimal64(6),           -- Realized P&L in USDC (6 decimals)
    total_bought           Decimal128(18),         -- Cumulative buys (18 decimals)

    -- Derived Fields (computed from token_id)
    condition_id           String,                 -- Condition ID (64 char hex, derived from token_id)
    outcome_index          UInt8,                  -- Outcome index (0-based, derived from token_id)

    -- Metadata Fields
    source_version         String DEFAULT '0.0.14', -- Subgraph version
    last_synced_at         DateTime DEFAULT now(), -- Last sync timestamp
    ingestion_timestamp    DateTime DEFAULT now(), -- When this record was ingested
    data_source            String DEFAULT 'goldsky_pnl_subgraph', -- Data source identifier

    -- Version Control for ReplacingMergeTree
    version                UInt64                  -- Monotonic version for upserts (unix timestamp ms)
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(last_synced_at)
ORDER BY (wallet_address, condition_id, outcome_index, composite_id)
SETTINGS index_granularity = 8192;

-- Indexes for common query patterns
-- Primary ORDER BY handles: by wallet, by condition, by wallet+condition
-- Additional indexes for token_id and realized_pnl queries would be via materialized views if needed

COMMENT ON TABLE pm_positions_indexer IS 'Global Polymarket positions from Goldsky PNL Subgraph. Authoritative source for all wallet positions across all markets. Uses ReplacingMergeTree for idempotent upserts.';

-- Usage Notes:
--
-- 1. UPSERT Pattern (Idempotent):
--    INSERT INTO pm_positions_indexer (composite_id, wallet_address, token_id, ..., version)
--    VALUES ('user-tokenId', '0xabc...', '0x123...', ..., toUnixTimestamp64Milli(now()))
--
-- 2. Query Latest State (auto-dedup):
--    SELECT * FROM pm_positions_indexer FINAL
--    WHERE wallet_address = '0xabc...'
--
-- 3. Partition Strategy:
--    - Monthly partitions by last_synced_at
--    - Allows efficient pruning of old sync data
--    - Active positions will be in recent partitions
--
-- 4. Token ID Decoding:
--    - token_id encodes both condition_id and outcome_index
--    - Decoding formula: condition_id = first 64 hex chars, outcome_index from collection bits
--    - See lib/polymarket/token-decoder.ts for implementation
--
-- 5. Decimal Precision:
--    - amount, total_bought: 18 decimals (matches ERC1155 shares)
--    - avg_price: 6 decimals (0.000001-1.000000 range)
--    - realized_pnl: 6 decimals (USDC standard)
--
-- 6. Data Freshness:
--    - Incremental sync every 5 minutes (recommended)
--    - Full backfill on initial setup (~13K wallets from subgraph)
--    - version field ensures latest data wins
