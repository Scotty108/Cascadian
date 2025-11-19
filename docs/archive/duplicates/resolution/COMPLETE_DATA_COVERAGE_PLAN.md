# Complete Data Coverage Plan - Cascadian

## Executive Summary

**Goal**: Full coverage of wallet 0x4ce7 (and all wallets) - from current 31 markets to 2,816+ total predictions

**Three-Phase Approach**:
1. **Fix P&L Views** (2 hours) - Unlock the 31 markets we already have
2. **API Backfill** (4-6 hours) - Get all 2,816 off-chain CLOB predictions
3. **Validate & Merge** (2 hours) - Combine and verify everything

**Total Time**: 8-10 hours (can run phases in parallel)

---

## Why We Need Both Sources

### What We Have (Blockchain - Complete ✅)
- **erc1155_transfers**: 291,113 rows (Dec 2022 - Nov 2025)
- **erc20_transfers_staging**: 387M rows (full history)
- **Coverage**: 1,048 days of on-chain activity

**For wallet 0x4ce7**: Only 5 ERC1155 token transfers → 31 markets

### What We're Missing (CLOB - Off-Chain ❌)
- **Polymarket Order Book**: Centralized exchange where most trading happens
- **Never Hits Blockchain**: Orders, fills, positions that don't settle on-chain
- **For wallet 0x4ce7**: 2,785 additional markets (98.9% of activity!)

### The Truth
Most Polymarket users trade via the CLOB. Only settlements/redemptions hit the blockchain. So:
- Blockchain = Truth for what settled
- CLOB API = Truth for what traded
- **We need both for complete coverage**

---

## Phase 1: Fix P&L Views (Immediate - 2 Hours)

### Why First?
The 31 markets we already have aren't showing in P&L. Fix this to validate our pipeline works.

### Tasks

#### 1.1: Update vw_trading_pnl_positions (30 min)

Already done via `fix-pnl-views-correct-join.ts`:
```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_positions AS
WITH
  pos AS (
    SELECT
      wallet,
      market_cid,
      outcome,
      sum(d_shares) AS position_shares,
      sum(d_cash) AS net_cash,
      sum(fee_usd) AS total_fees_usd
    FROM cascadian_clean.vw_trades_ledger
    GROUP BY wallet, market_cid, outcome
  ),
  market_conditions AS (
    SELECT
      market_id_cid AS market_cid,
      any(lower(condition_id_32b)) AS condition_id_32b
    FROM cascadian_clean.token_condition_market_map
    GROUP BY market_id_cid
  )
SELECT
  pos.wallet AS wallet,
  pos.market_cid AS market_cid,
  pos.outcome AS outcome,
  pos.position_shares AS position_shares,
  pos.net_cash AS net_cash,
  pos.total_fees_usd AS total_fees_usd,
  if(
    abs(pos.position_shares) < 0.01 OR
    (mc.condition_id_32b IS NOT NULL AND r.condition_id_32b IS NOT NULL),
    'CLOSED',
    'OPEN'
  ) AS status
FROM pos
LEFT JOIN market_conditions AS mc ON mc.market_cid = pos.market_cid
LEFT JOIN cascadian_clean.vw_resolutions_truth AS r ON r.condition_id_32b = mc.condition_id_32b
```

**Status**: ✅ Already updated

#### 1.2: Fix vw_redemption_pnl (30 min)

Use `vw_trades_ledger` as source instead of `vw_trades_canonical`:
```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_redemption_pnl AS
WITH positions_at_resolution AS (
  SELECT
    wallet,
    market_cid,
    outcome,
    sum(d_shares) AS net_shares,
    sum(d_cash) AS net_cash
  FROM cascadian_clean.vw_trades_ledger
  GROUP BY wallet, market_cid, outcome
),
market_resolutions AS (
  SELECT
    m.market_id_cid AS market_cid,
    any(r.payout_numerators) AS payout_numerators,
    any(r.payout_denominator) AS payout_denominator,
    any(r.winning_index) AS winning_index
  FROM cascadian_clean.token_condition_market_map m
  INNER JOIN cascadian_clean.vw_resolutions_truth r
    ON r.condition_id_32b = lower(m.condition_id_32b)
  GROUP BY m.market_id_cid
)
SELECT
  p.wallet AS wallet,
  p.market_cid AS market_cid,
  p.outcome AS outcome,
  p.net_shares AS net_shares,
  p.net_cash AS net_cash,
  r.winning_index AS winning_index,
  if(
    p.outcome < length(r.payout_numerators),
    toFloat64(arrayElement(r.payout_numerators, p.outcome + 1)) / nullIf(toFloat64(r.payout_denominator), 0),
    0.
  ) AS payout_value,
  (p.net_shares * if(
    p.outcome < length(r.payout_numerators),
    toFloat64(arrayElement(r.payout_numerators, p.outcome + 1)) / nullIf(toFloat64(r.payout_denominator), 0),
    0.
  )) + p.net_cash AS redemption_pnl_usd
FROM positions_at_resolution AS p
INNER JOIN market_resolutions AS r ON r.market_cid = p.market_cid
WHERE abs(p.net_shares) >= 0.01
```

**Script**: `fix-redemption-pnl-view.ts` (needs re-run with vw_trades_ledger source)

#### 1.3: Verify vw_wallet_pnl_unified (30 min)

Test that it now shows:
- Trading P&L from closed positions
- Redemption P&L from resolved markets
- Combined total

```bash
npx tsx trace-wallet-data.ts
```

Expected for 0x4ce7 after Phase 1:
- Closed positions: 30
- Trading P&L: ~-$588
- Redemption P&L: TBD (depends on if resolutions exist)
- Total: Trading + Redemption

#### 1.4: Document Baseline (30 min)

Create `PNL_PHASE1_RESULTS.md`:
- Current market coverage (31/2,816)
- P&L breakdown by component
- Comparison to Polymarket
- Readiness for Phase 2

---

## Phase 2: API Backfill for CLOB Data (4-6 Hours)

### Why This Phase?
Get the missing 2,785 markets that only exist in Polymarket's CLOB (never settled on-chain).

### 2.1: Understand API Coverage (1 hour)

Review existing scripts:
- `backfill-wallet-pnl-from-api.ts` - Wallet positions endpoint
- `worker-clob-api*.ts` - CLOB fills endpoint
- `backfill-polymarket-api.ts` - Market metadata

Check which endpoints we need:
1. **GET /positions** - User's current positions
2. **GET /trades** - Historical CLOB fills
3. **GET /markets** - Market metadata
4. **GET /rewards** - If needed for P&L reconciliation

### 2.2: Set Up API Infrastructure (1 hour)

**Create staging tables**:
```sql
-- CLOB trades (off-chain order book fills)
CREATE TABLE IF NOT EXISTS default.clob_fills_staging (
  id String,
  market String,
  asset_id String,
  maker_address String,
  taker_address String,
  side Enum8('BUY' = 1, 'SELL' = 2),
  size Float64,
  price Float64,
  fee_rate_bps UInt16,
  timestamp DateTime,
  transaction_hash String,
  maker_orders Array(String),
  source LowCardinality(String) DEFAULT 'clob_api'
) ENGINE = ReplacingMergeTree()
ORDER BY (maker_address, taker_address, timestamp, id);

-- API positions (current holdings)
CREATE TABLE IF NOT EXISTS default.api_positions_staging (
  wallet_address String,
  market String,
  condition_id String,
  asset_id String,
  outcome UInt8,
  size Float64,
  entry_price Nullable(Float64),
  timestamp DateTime,
  source LowCardinality(String) DEFAULT 'api_positions'
) ENGINE = ReplacingMergeTree()
ORDER BY (wallet_address, market, outcome, timestamp);

-- Market metadata from API
CREATE TABLE IF NOT EXISTS default.api_markets_staging (
  condition_id String,
  market_slug String,
  question String,
  outcomes Array(String),
  active Boolean,
  closed Boolean,
  resolved Boolean,
  winning_outcome Nullable(UInt8),
  end_date Nullable(DateTime),
  timestamp DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree()
ORDER BY (condition_id, timestamp);
```

**Run**: `npx tsx scripts/setup-api-staging-tables.ts`

### 2.3: Backfill CLOB Trades (2-3 hours)

**Script**: `backfill-clob-trades-comprehensive.ts`

```typescript
// Pseudo-code structure
async function backfillCLOBTrades(wallet: string) {
  // 1. Get all CLOB fills for wallet (paginated)
  const fills = await fetchAllCLOBFills(wallet);

  // 2. Insert into clob_fills_staging
  await insertCLOBFills(fills);

  // 3. Map to canonical trade format
  await transformCLOBToTrades();

  // 4. Merge with blockchain trades (dedupe by tx_hash)
  await mergeTradesources();
}
```

**Endpoints**:
- `GET /trades?maker={wallet}` - Maker side
- `GET /trades?taker={wallet}` - Taker side
- Paginate through all historical trades

**Expected for 0x4ce7**: ~2,785 additional markets

### 2.4: Backfill Positions (1 hour)

**Script**: `backfill-api-positions.ts`

```bash
# Single wallet
npx tsx backfill-api-positions.ts --wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad

# Top N wallets
npx tsx backfill-api-positions.ts --top-wallets 100
```

**What it does**:
- Fetches current positions from Polymarket API
- Maps condition_id to our canonical IDs
- Inserts into `api_positions_staging`
- Useful for validation and current state

### 2.5: Map API → Canonical (1 hour)

**Challenge**: API uses different ID formats than blockchain

**Mapping tables**:
- `condition_market_map` - condition_id ↔ market_id
- `api_ctf_bridge` - API condition_id → blockchain condition_id
- `ctf_token_map` - token_id ↔ condition_id

**Script**: `map-api-to-canonical.ts`

```sql
-- Example mapping query
SELECT
  c.condition_id as api_condition_id,
  m.condition_id_32b as blockchain_condition_id,
  m.market_id_cid,
  m.market_slug
FROM default.clob_fills_staging c
LEFT JOIN cascadian_clean.api_ctf_bridge b
  ON b.api_condition_id = c.asset_id
LEFT JOIN cascadian_clean.condition_market_map m
  ON m.condition_id_32b = b.blockchain_condition_id
```

---

## Phase 3: Merge & Validate (2 Hours)

### 3.1: Create Unified Trade View (1 hour)

**Script**: `create-unified-trades-view.ts`

```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_trades_unified AS
SELECT
  wallet_address_norm as wallet,
  market_cid,
  outcome_index as outcome,
  trade_direction,
  shares,
  price,
  usd_value,
  fee_usd,
  block_timestamp as timestamp,
  tx_hash,
  'blockchain' as source
FROM default.vw_trades_canonical

UNION ALL

SELECT
  if(side = 'BUY', maker_address, taker_address) as wallet,
  m.market_id_cid as market_cid,
  -- Derive outcome from asset_id
  toUInt8(substring(asset_id, -2)) as outcome,
  side as trade_direction,
  size as shares,
  price,
  size * price as usd_value,
  size * price * (fee_rate_bps / 10000.0) as fee_usd,
  timestamp,
  transaction_hash as tx_hash,
  'clob_api' as source
FROM default.clob_fills_staging c
LEFT JOIN cascadian_clean.condition_market_map m
  ON m.condition_id_32b = /* map from asset_id */
WHERE transaction_hash NOT IN (
  SELECT DISTINCT tx_hash
  FROM default.vw_trades_canonical
  WHERE tx_hash != ''
)  -- Dedupe: exclude CLOB fills that also appear on-chain
```

### 3.2: Rebuild P&L Views (30 min)

Point all P&L views to `vw_trades_unified` instead of `vw_trades_canonical`:

```bash
npx tsx update-pnl-views-to-unified.ts
```

This updates:
- `vw_trades_ledger` → source from `vw_trades_unified`
- `vw_trading_pnl_positions` → inherits the change
- `vw_redemption_pnl` → inherits the change
- `vw_wallet_pnl_unified` → now includes CLOB data

### 3.3: Validate Results (30 min)

**Script**: `validate-complete-coverage.ts`

```bash
npx tsx validate-complete-coverage.ts --wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad
```

**Expected Output**:
```
Wallet: 0x4ce73141dbfce41e65db3723e31059a730f0abad

Data Sources:
  Blockchain trades: 38
  CLOB API trades: ~5,600
  Total unified: ~5,638

Markets:
  Blockchain only: 31
  CLOB only: 2,785
  Total unique: 2,816 ✅

P&L Breakdown:
  Trading P&L (realized): $XXX
  Redemption P&L (settled): $XXX
  Unrealized P&L (open): $XXX
  Total P&L: $332,563 ✅

Polymarket Comparison:
  Polymarket total: $332,563
  Our calculation: $332,563
  Match: 100.0% ✅
```

---

## Implementation Order

### Parallel Track A (Can Run Simultaneously)
1. ✅ Fix P&L views (Phase 1.1-1.3)
2. ⏳ Test with current data (Phase 1.4)

### Parallel Track B (Can Run While A Validates)
1. ⏳ Set up API infrastructure (Phase 2.1-2.2)
2. ⏳ Start CLOB backfill (Phase 2.3) - runs overnight
3. ⏳ Backfill positions (Phase 2.4)
4. ⏳ Map API → Canonical (Phase 2.5)

### Sequential Track C (After A + B Complete)
1. ⏳ Merge data sources (Phase 3.1)
2. ⏳ Rebuild P&L (Phase 3.2)
3. ⏳ Validate (Phase 3.3)

---

## Scripts to Create

1. **`fix-redemption-pnl-final.ts`** - Update redemption view with correct source
2. **`setup-api-staging-tables.ts`** - Create CLOB staging schema
3. **`backfill-clob-trades-comprehensive.ts`** - Fetch all CLOB fills
4. **`backfill-api-positions.ts`** - Fetch current positions
5. **`map-api-to-canonical.ts`** - ID mapping and normalization
6. **`create-unified-trades-view.ts`** - Combine blockchain + CLOB
7. **`update-pnl-views-to-unified.ts`** - Point views to unified source
8. **`validate-complete-coverage.ts`** - End-to-end verification

---

## Success Criteria

### Phase 1 Complete
- [ ] vw_trading_pnl_positions shows 30 CLOSED positions for 0x4ce7
- [ ] vw_redemption_pnl calculates redemption P&L (if resolutions exist)
- [ ] vw_wallet_pnl_unified shows combined P&L
- [ ] Baseline documented in PNL_PHASE1_RESULTS.md

### Phase 2 Complete
- [ ] clob_fills_staging has ~5,600 trades for 0x4ce7
- [ ] api_positions_staging has current positions
- [ ] All API condition_ids mapped to canonical format
- [ ] No duplicate trades (blockchain + CLOB dedupe working)

### Phase 3 Complete
- [ ] vw_trades_unified shows 2,816 unique markets for 0x4ce7
- [ ] Total P&L matches Polymarket: $332,563 (within 1%)
- [ ] Coverage: 100% of Polymarket predictions
- [ ] Documentation: Complete before/after analysis

---

## Next Steps

1. **Run Phase 1 now** - Fix existing views (2 hours)
2. **Start Phase 2 in parallel** - CLOB backfill (can run overnight)
3. **Complete Phase 3 tomorrow** - Merge and validate (2 hours)

**Total Timeline**: 8-10 hours spread over 1-2 days

---

## Files Referenced

**Already Created**:
- `fix-pnl-views-correct-join.ts` ✅
- `fix-redemption-pnl-view.ts` (needs update)
- `trace-wallet-data.ts` ✅
- `RUN_FULL_HISTORICAL_BACKFILL.md` ✅

**To Create**:
- All Phase 2 and 3 scripts listed above
- Validation and documentation scripts

Would you like me to start with Phase 1 now, or create all the Phase 2 scripts first?
