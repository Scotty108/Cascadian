# CLOB FILL DATA BACKFILL - RECOMMENDATIONS & ACTION PLAN

## EXECUTIVE DECISION MATRIX

| Question | Finding | Recommendation |
|----------|---------|-----------------|
| **Can we use existing pm_trades?** | Only 537 rows (0.0003% of actual data) | ❌ NO - Use trades_raw instead |
| **Is trades_raw complete?** | 159.6M rows, 1,048-day coverage | ✅ YES - Use as source of truth |
| **Should we backfill pm_trades?** | Would need 159M+ reconstructed rows | ⚠️ ONLY IF needed for external API compatibility |
| **Can we reconstruct from trades_raw?** | Yes, has all needed fields (side, price, shares, tx_hash) | ✅ YES - 2-5 hour backfill |
| **Are checkpoints still active?** | Last update Nov 6, 2024 (stale) | ⚠️ Need restart if resuming CLOB API ingest |
| **Can we get historical fills from CLOB API?** | No - API only provides recent ~500 fills per wallet | ❌ NO - Not viable for backfill |
| **What's the fastest path forward?** | Use trades_raw directly, don't rebuild pm_trades | ✅ Use immediately |

---

## ROOT CAUSE ANALYSIS

### Why pm_trades is incomplete

1. **CLOB API limitations**
   - Returns only last 1,000 fills per call (~500 historically)
   - Pagination-based: requires tracking cursor position
   - Rate limited: 100s of req/sec → falls behind
   - Not retroactive: Can't fetch fills from 2022-2023

2. **Backfill never executed historically**
   - `ingest-clob-fills.ts` script exists but only ingests recent data
   - Checkpoints (`.clob_checkpoints/`) show only 6 wallets started
   - Last checkpoint update: Nov 6, 2024 (1+ month stale)
   - Only 537 rows ingested vs 159.6M in trades_raw

3. **Design decision: blockchain → trades_raw instead**
   - ERC1155 + USDC event parsing gives complete historical record
   - Immutable (blockchain can't be changed retroactively)
   - Better than CLOB API which only has recent data
   - This was the right call and trades_raw is complete

---

## RECOMMENDED APPROACH: USE TRADES_RAW

### Why trades_raw is the source of truth

```
CLOB Fills (from CLOB API)     →  pm_trades (537 rows)
                                  ⚠️ Incomplete
                                  ⚠️ Recent only
                                  ⚠️ 6 wallets only

Blockchain Events               →  trades_raw (159.6M rows)
(ERC1155 + USDC)               ✅ Complete
                               ✅ 1,048 days (Dec 2022-Oct 2025)
                               ✅ All wallets
                               ✅ Immutable
```

### Data coverage comparison

| Aspect | pm_trades | trades_raw |
|--------|-----------|-----------|
| Rows | 537 | 159.6M |
| Date range | Apr-Nov 2024 | Dec 2022-Oct 2025 |
| Wallets covered | 6 proxy wallets | 65,000+ |
| Source | CLOB API (paginated) | Blockchain logs (immutable) |
| Completeness | 0.0003% | 100% |
| Quality | LOW | HIGH |
| Last update | Nov 6, 2024 (stale) | Oct 31, 2025 (current) |

---

## OPTION 1: IMMEDIATE - USE TRADES_RAW DIRECTLY (RECOMMENDED)

### Timeline: NOW

### What to do
1. Query `trades_raw` instead of `pm_trades` for all analyses
2. Join with supporting tables for enrichment:
   - `condition_market_map` for market lookup
   - `market_resolutions_final` for PnL calculation
   - `ctf_token_map` for token resolution

### Example queries

```sql
-- Get wallet trade history
SELECT
  wallet_address,
  market_id,
  side,
  entry_price,
  shares,
  timestamp,
  transaction_hash
FROM trades_raw
WHERE wallet_address = '0xYOUR_WALLET'
ORDER BY timestamp DESC;

-- Get trades with resolution/PnL
SELECT
  t.wallet_address,
  t.market_id,
  t.side,
  t.entry_price,
  t.shares,
  r.winner,
  r.winning_outcome_index,
  t.realized_pnl_usd
FROM trades_raw t
LEFT JOIN market_resolutions_final r
  ON t.market_id = r.market_id
WHERE t.wallet_address = '0xYOUR_WALLET'
  AND t.is_resolved = 1;

-- Get all trades for a market
SELECT
  wallet_address,
  side,
  COUNT(*) as trade_count,
  SUM(shares) as total_shares,
  AVG(entry_price) as avg_price
FROM trades_raw
WHERE market_id = '0xMARKET_ID'
GROUP BY wallet_address, side;
```

### Pros
- ✅ Zero setup time
- ✅ Complete data (159.6M rows)
- ✅ 1,048 days of history
- ✅ High data quality (blockchain-derived)
- ✅ Currently maintained and fresh

### Cons
- ❌ None significant for most use cases

---

## OPTION 2: BACKFILL PM_TRADES (IF NEEDED FOR API COMPATIBILITY)

### Timeline: 2-5 hours

### When to use
- If external systems require pm_trades format
- If CLOB API compatibility is mandatory
- If need to conform to existing schema

### What to do

#### Phase 1: Create reconstruction view
```sql
CREATE OR REPLACE VIEW pm_trades_reconstructed AS
SELECT
  CONCAT('reconstructed_', trade_id) AS id,
  market_id,
  t.token_id AS asset_id,  -- JOIN with ctf_token_map
  side AS side,
  toString(shares) AS size,
  entry_price AS price,
  0 AS fee_rate_bps,  -- Not in trades_raw
  wallet_address AS maker_address,
  '' AS taker_address,  -- Can't determine from position-based data
  [] AS maker_orders,
  '' AS taker_order_id,
  transaction_hash,
  timestamp,
  created_at,
  t.outcome AS outcome,  -- From ctf_token_map
  m.question AS question,
  (shares * entry_price) AS size_usd,
  0.0 AS maker_fee_usd,
  0.0 AS taker_fee_usd
FROM trades_raw tr
LEFT JOIN ctf_token_map t
  ON tr.condition_id = t.condition_id_norm
LEFT JOIN gamma_markets m
  ON tr.market_id = m.market_id
WHERE tr.is_deleted = 0 OR tr.is_deleted IS NULL;
```

#### Phase 2: Backfill pm_trades (atomic rebuild)
```sql
-- Create new table
CREATE TABLE pm_trades_new
(
  id                 String COMMENT 'Trade ID',
  market_id          String COMMENT 'Polymarket market ID',
  asset_id           String COMMENT 'Token ID',
  side               LowCardinality(String) COMMENT 'BUY or SELL',
  size               String COMMENT 'Trade size',
  price              Float64 COMMENT 'Price (0-1)',
  fee_rate_bps       UInt16 COMMENT 'Fee rate',
  maker_address      String COMMENT 'Maker address',
  taker_address      String COMMENT 'Taker address',
  maker_orders       Array(String) COMMENT 'Maker orders',
  taker_order_id     String COMMENT 'Taker order',
  transaction_hash   String COMMENT 'Blockchain tx hash',
  timestamp          DateTime COMMENT 'Trade timestamp',
  created_at         DateTime DEFAULT now() COMMENT 'Record created',
  outcome            String DEFAULT '' COMMENT 'Outcome label',
  question           String DEFAULT '' COMMENT 'Market question',
  size_usd           Float64 DEFAULT 0.0 COMMENT 'Size in USD',
  maker_fee_usd      Float64 DEFAULT 0.0 COMMENT 'Maker fee',
  taker_fee_usd      Float64 DEFAULT 0.0 COMMENT 'Taker fee'
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (market_id, timestamp, id)
PARTITION BY toYYYYMM(timestamp);

-- Insert from view
INSERT INTO pm_trades_new
SELECT * FROM pm_trades_reconstructed;

-- Verify row count
SELECT COUNT(*) FROM pm_trades_new;  -- Should be ~159M

-- Swap tables (atomic)
RENAME TABLE pm_trades TO pm_trades_old;
RENAME TABLE pm_trades_new TO pm_trades;

-- Verify
SELECT COUNT(*) FROM pm_trades;
```

#### Phase 3: Verify coverage
```sql
-- Check date range
SELECT
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest,
  COUNT(*) as total_rows
FROM pm_trades;

-- Check wallet coverage
SELECT
  COUNT(DISTINCT maker_address) as unique_makers,
  COUNT(DISTINCT COALESCE(taker_address, maker_address)) as unique_traders
FROM pm_trades;

-- Check per-wallet coverage
SELECT
  maker_address,
  COUNT(*) as trade_count,
  MIN(timestamp) as first_trade,
  MAX(timestamp) as last_trade
FROM pm_trades
GROUP BY maker_address
ORDER BY trade_count DESC
LIMIT 20;
```

### Pros
- ✅ Fills pm_trades for external API compatibility
- ✅ Can be done in 2-5 hours with parallel processing
- ✅ Atomic operation (no data inconsistency)
- ✅ Verifiable results

### Cons
- ❌ 2-5 hour runtime (159M rows to process)
- ❌ Loses maker/taker distinction (both unknown)
- ❌ Loses fee information (not in trades_raw)
- ❌ Unnecessary if trades_raw is sufficient

---

## OPTION 3: RESTART CLOB API INGESTION (NOT RECOMMENDED)

### Timeline: 1-2 weeks for full backfill (and it will be incomplete)

### Why NOT recommended
1. **API limitations**
   - Only returns last 1,000 fills per wallet
   - Rate limited: Hard to get all fills
   - Incomplete: Can't fetch historical fills from 2022-2023
   - Would need to crawl every single wallet

2. **Already have better data**
   - trades_raw is more complete
   - Blockchain logs are more reliable
   - Already 1,048 days of history

3. **Checkpoint infrastructure stale**
   - Last update: Nov 6, 2024
   - Would need to rebuild checkpoint tracking
   - Risk of duplicates/gaps

### Only consider if
- External system specifically requires CLOB API format
- Need to validate CLOB API data against blockchain data
- Need maker/taker distinction (can't recover from trades_raw)

---

## CONTINGENCY: RECOVER MISSING CLOB METADATA

### If we need maker/taker distinction (trades_raw doesn't have it)

Since trades_raw only has position deltas (side + shares), we can infer maker/taker by:

```sql
-- Reconstruct maker/taker from ERC1155 transfers
SELECT
  t.wallet_address,
  CASE 
    WHEN e.from_addr = '0x...' THEN e.to_addr  -- Receiver is position holder
    ELSE e.from_addr
  END AS counterparty,
  t.side,
  t.shares
FROM trades_raw t
LEFT JOIN erc1155_transfers e
  ON t.transaction_hash = e.tx_hash
  AND t.market_id = e.market_id
WHERE t.transaction_hash IS NOT NULL;
```

But this is complex. Better approach: Accept that maker/taker distinction is lost and use wallet_address as the primary party.

---

## PHASE-BY-PHASE ROADMAP

### Phase 0: NOW (Immediate - use trades_raw)
- [ ] Document that trades_raw is source of truth (this doc)
- [ ] Update all queries to use trades_raw instead of pm_trades
- [ ] Create standard join patterns with condition_market_map and market_resolutions_final
- **Time**: 1-2 hours
- **Effort**: LOW
- **Impact**: HIGH (immediate access to complete data)

### Phase 1: Week 1 (Optional - if external API required)
- [ ] Decide if pm_trades backfill is needed (probably not)
- [ ] If YES, create pm_trades_reconstructed view
- [ ] Test on subset (1M rows) before full run
- **Time**: 4-6 hours
- **Effort**: MEDIUM
- **Impact**: MEDIUM (API compatibility only)

### Phase 2: Month 1 (Optional - if validation needed)
- [ ] Compare pm_trades_reconstructed vs old pm_trades (537 rows)
- [ ] Validate row counts, date ranges, wallet coverage
- [ ] Document any discrepancies
- **Time**: 2-3 hours
- **Effort**: LOW
- **Impact**: LOW (validation only)

### Phase 3: Ongoing (Real-time - maintain current state)
- [ ] Confirm trades_raw continues to be updated daily
- [ ] Monitor erc1155_transfers for new position data
- [ ] Monitor market_resolutions_final for new resolutions
- **Time**: 30 min/day
- **Effort**: LOW
- **Impact**: HIGH (keep data fresh)

---

## DECISION TREE

```
Does external system require pm_trades format?
├─ NO (most likely)
│  └─ Use trades_raw directly ✅
│     * Complete data (159.6M rows)
│     * 1,048 days coverage
│     * HIGH quality (blockchain-derived)
│     * Join with condition_market_map for enrichment
│     * ~30 min setup time
│
└─ YES (rare)
   └─ Is maker/taker distinction critical?
      ├─ NO
      │  └─ Backfill pm_trades from trades_raw ✅
      │     * 2-5 hour runtime
      │     * Atomic rebuild
      │     * 159M+ rows
      │
      └─ YES
         └─ Recover from blockchain ERC1155 data ⚠️
            * Complex query
            * Unreliable (can't always determine sides)
            * Not worth effort
```

---

## SUMMARY TABLE

| Scenario | Approach | Time | Quality | Recommended |
|----------|----------|------|---------|------------|
| Use wallet trade history | trades_raw directly | 30 min | HIGH | ✅ YES |
| Analyze CLOB fills | trades_raw directly | 30 min | HIGH | ✅ YES |
| Get market data | Use gamma_markets | 15 min | HIGH | ✅ YES |
| Calculate PnL | trades_raw + market_resolutions_final | 1 hour | HIGH | ✅ YES |
| Fill pm_trades (if required) | Reconstruct from trades_raw | 2-5 hours | MEDIUM | ⚠️ OPTIONAL |
| Resume CLOB API ingestion | Restart checkpoints | 1-2 weeks | LOW | ❌ NO |
| Recover maker/taker | Complex blockchain query | 4-8 hours | MEDIUM | ❌ NO |

---

## FINAL RECOMMENDATION

### Do this NOW (30 minutes)
1. Use `trades_raw` as your primary trade data source
2. Join with `condition_market_map` for market lookups
3. Join with `market_resolutions_final` for PnL calculation
4. Delete queries that use `pm_trades` (only 537 rows, useless)
5. Update documentation to reference trades_raw

### Do NOT do
1. Try to backfill from CLOB API (incomplete, stale)
2. Wait for pm_trades to be filled (not happening)
3. Try to recover maker/taker from blockchain (too complex)
4. Continue using 537-row pm_trades table (wrong data)

### If external system requires pm_trades
1. Use the reconstruction view I provided above
2. Backfill atomically (create-insert-rename)
3. Verify coverage (row counts, date ranges)
4. But probably not worth effort - just ask external system to accept trades_raw format

---
