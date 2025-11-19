# Detailed Rebuild Tables: Exact SQL & File Locations

## Quick Reference: All Scripts in Order

```
ABSOLUTE PATHS:

/Users/scotty/Projects/Cascadian-app/scripts/create-transfer-staging-tables.ts
  ├─ Creates: erc20_transfers_staging
  ├─ Creates: erc1155_transfers_staging
  ├─ Creates: backfill_checkpoint
  └─ Creates: worker_heartbeats

/Users/scotty/Projects/Cascadian-app/scripts/step3-streaming-backfill-parallel.ts
  ├─ Populates: erc20_transfers_staging (2-5 hours)
  └─ Populates: erc1155_transfers_staging (2-5 hours)

/Users/scotty/Projects/Cascadian-app/scripts/flatten-erc1155.ts
  └─ Creates: pm_erc1155_flats

/Users/scotty/Projects/Cascadian-app/scripts/build-approval-proxies.ts
  └─ Creates: pm_user_proxy_wallets

/Users/scotty/Projects/Cascadian-app/scripts/flatten-erc1155-correct.ts
  └─ Enriches: pm_erc1155_flats

/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/016_enhance_polymarket_tables.sql
  ├─ Alters: ctf_token_map (adds market_id, outcome, outcome_index, question)
  ├─ Creates: pm_trades (CLOB fills)
  ├─ Creates: markets_enriched (view)
  ├─ Creates: token_market_enriched (view)
  ├─ Creates: proxy_wallets_active (view)
  ├─ Creates: erc1155_transfers_enriched (view)
  └─ Creates: wallet_positions_current (view)

/Users/scotty/Projects/Cascadian-app/scripts/daily-sync-polymarket.ts
  ├─ Recreates: outcome_positions_v2 (daily)
  └─ Recreates: trade_cashflows_v3 (daily)

/Users/scotty/Projects/Cascadian-app/scripts/build-trades-dedup-mat.ts
  ├─ Creates: trades_dedup_keyed (view)
  ├─ Creates: trades_dedup_mat (ReplacingMergeTree)
  ├─ Recreates: outcome_positions_v2 (alternative)
  ├─ Recreates: trade_cashflows_v3 (alternative)
  └─ Recreates: realized_pnl_by_market_final (alternative)

/Users/scotty/Projects/Cascadian-app/scripts/fast-dedup-rebuild.ts
  ├─ Drops: trades_dedup_mat
  ├─ Creates: trades_dedup_view
  ├─ Creates: trades_dedup_mat (MergeTree)
  ├─ Recreates: outcome_positions_v2 (from dedup_mat)
  └─ Recreates: trade_cashflows_v3 (from dedup_mat)

/Users/scotty/Projects/Cascadian-app/scripts/fix-realized-pnl-view.ts
  └─ Recreates: realized_pnl_by_market_final

/Users/scotty/Projects/Cascadian-app/scripts/backfill-market-ids.ts
  └─ Reads: trades_raw and attempts to backfill market_id
```

---

## 1. DAILY REBUILD SCRIPT (Primary)

**File:** `/Users/scotty/Projects/Cascadian-app/scripts/daily-sync-polymarket.ts`

This is the **primary daily rebuild** script that regenerates the P&L tables.

### Step 1: Rebuild outcome_positions_v2

```sql
CREATE TABLE outcome_positions_v2_new AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  outcome_idx,
  SUM(CAST(balance AS Float64)) AS net_shares
FROM erc1155_transfers
WHERE outcome_idx >= 0
GROUP BY wallet, market_id, condition_id_norm, outcome_idx
HAVING net_shares != 0;

RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;
RENAME TABLE outcome_positions_v2_new TO outcome_positions_v2;
DROP TABLE outcome_positions_v2_old;
```

**Key Points:**
- Source: `erc1155_transfers` table
- Fields aggregated: wallet, market_id, condition_id_norm, outcome_idx
- Operation: SUM of balances, HAVING non-zero
- Pattern: Atomic rename (safe for production)
- Time: Minutes to complete

### Step 2: Rebuild trade_cashflows_v3

```sql
CREATE TABLE trade_cashflows_v3_new AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  SUM(CAST(value AS Float64)) AS cashflow_usdc
FROM erc20_transfers
WHERE token_type = 'USDC'
GROUP BY wallet, market_id, condition_id_norm;

RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old;
RENAME TABLE trade_cashflows_v3_new TO trade_cashflows_v3;
DROP TABLE trade_cashflows_v3_old;
```

**Key Points:**
- Source: `erc20_transfers` table
- Fields aggregated: wallet, market_id, condition_id_norm
- Operation: SUM of USDC values
- Filter: Only USDC token_type
- Pattern: Atomic rename
- Time: Minutes to complete

---

## 2. SOURCE TABLES (erc1155_transfers & erc20_transfers)

These are created from the staging tables and blockchain data.

### erc1155_transfers
**Expected Schema:**
```
wallet          String
market_id       String (FORMAT INCONSISTENT: HEX or INTEGER)
condition_id_norm String (normalized 64-char hex)
outcome_idx     Int16 (0-based)
balance         Float64 (net token amount)
```

**Populated By:**
- `step3-streaming-backfill-parallel.ts` → erc1155_transfers_staging
- `flatten-erc1155.ts` → pm_erc1155_flats
- Enrichment pipeline

### erc20_transfers
**Expected Schema:**
```
wallet          String
market_id       String (FORMAT INCONSISTENT: HEX or INTEGER)
condition_id_norm String (normalized 64-char hex)
value           Float64 (USDC amount)
token_type      String ('USDC')
```

**Populated By:**
- `step3-streaming-backfill-parallel.ts` → erc20_transfers_staging
- Enrichment & aggregation

---

## 3. ALTERNATIVE REBUILD: Build Trades Dedup Mat

**File:** `/Users/scotty/Projects/Cascadian-app/scripts/build-trades-dedup-mat.ts`

Creates a **ReplacingMergeTree** table instead of building directly from transfers.

### Step 1: Create Keyed Dedup View

```sql
CREATE OR REPLACE VIEW trades_dedup_keyed AS
SELECT
  -- deterministic key
  multiIf(
    lengthUTF8(toString(trade_id)) > 0,
      concat('id:', toString(trade_id)),
    transaction_hash != '' AND log_index IS NOT NULL,
      concat('tx:', lower(toString(transaction_hash)), ':', toString(toInt32OrNull(log_index)), ':', lower(toString(wallet_address))),
    -- fallback: wallet+market+outcome+block+rounded price/shares
      concat(
        'fx:',
        lower(toString(wallet_address)), ':', lower(toString(market_id)), ':', toString(toInt16OrNull(outcome_index)), ':',
        toString(toUInt64OrNull(block_number)), ':',
        toString(round(toFloat64(entry_price)*10000)), ':',
        toString(round(toFloat64(shares)*1000))
      )
  ) AS dedup_key,
  *
FROM trades_raw
```

### Step 2: Create Materialized Table

```sql
CREATE TABLE trades_dedup_mat
(
  dedup_key String,
  wallet_address String,
  market_id String,
  condition_id String,
  outcome_index Int16,
  side LowCardinality(String),
  entry_price Float64,
  shares Float64,
  transaction_hash String,
  log_index Int32,
  block_number UInt64,
  created_at DateTime64(3),
  trade_id String,
  _version DateTime64(3)
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY dedup_key
```

### Step 3: Insert Deduplicated Data

```sql
INSERT INTO trades_dedup_mat
SELECT
  dedup_key,
  lower(toString(wallet_address)) AS wallet_address,
  lower(toString(market_id)) AS market_id,
  toString(condition_id) AS condition_id,
  toInt16OrNull(outcome_index) AS outcome_index,
  toString(side) AS side,
  toFloat64(entry_price) AS entry_price,
  toFloat64(shares) AS shares,
  lower(toString(transaction_hash)) AS transaction_hash,
  toInt32OrNull(log_index) AS log_index,
  toUInt64OrNull(block_number) AS block_number,
  parseDateTime64BestEffortOrNull(toString(created_at)) AS created_at,
  toString(trade_id) AS trade_id,
  coalesce(parseDateTime64BestEffortOrNull(toString(created_at)), now64(3)) AS _version
FROM trades_dedup_keyed
```

### Step 4: Views Using Dedup Mat

```sql
-- outcome_positions_v2 using dedup_mat
CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  wallet_address AS wallet,
  market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16OrNull(outcome_index) AS outcome_idx,
  sum(if(side IN ('YES','BUY','Buy','buy','1'),  1.0, -1.0) * shares) AS net_shares
FROM trades_dedup_mat
WHERE market_id NOT IN ('12')
GROUP BY wallet_address, market_id, condition_id, outcome_index
```

```sql
-- trade_cashflows_v3 using dedup_mat
CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  wallet_address AS wallet,
  market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16OrNull(outcome_index) AS outcome_idx,
  case
    when entry_price > 10000 then entry_price/10000
    when entry_price > 100 then entry_price/100
    else entry_price
  end AS px_norm,
  abs(shares) AS sh_norm,
  if(side IN ('YES','BUY','Buy','buy', '1'), -px_norm*sh_norm, px_norm*sh_norm) AS cashflow_usdc
FROM trades_dedup_mat
WHERE market_id NOT IN ('12')
```

### Step 5: Realized PnL View

```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx, resolved_at FROM winning_index
)
SELECT
  p.wallet,
  p.market_id,
  p.condition_id_norm,
  w.resolved_at,
  round(
    sumIf(p.net_shares, p.outcome_idx = w.win_idx)
    + sum(-c.cashflow_usdc)
  , 4) AS realized_pnl_usd
FROM outcome_positions_v2 p
ANY LEFT JOIN trade_cashflows_v3 c
  ON c.wallet = p.wallet
 AND c.market_id = p.market_id
 AND c.condition_id_norm = p.condition_id_norm
 AND c.outcome_idx = p.outcome_idx
ANY LEFT JOIN win w USING (condition_id_norm)
WHERE w.win_idx IS NOT NULL
GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at
```

---

## 4. FAST DEDUP REBUILD (Simpler Alternative)

**File:** `/Users/scotty/Projects/Cascadian-app/scripts/fast-dedup-rebuild.ts`

### Step 1: Create Dedup View (row_number)

```sql
CREATE OR REPLACE VIEW trades_dedup_view AS
SELECT * EXCEPT rn
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY transaction_hash, lower(wallet_address)
      ORDER BY created_at
    ) AS rn
  FROM trades_raw
)
WHERE rn = 1
```

### Step 2: Create Materialized Table

```sql
CREATE TABLE trades_dedup_mat
ENGINE = MergeTree
ORDER BY (lower(wallet_address), market_id, outcome_index)
SETTINGS index_granularity = 8192
AS
SELECT * FROM trades_dedup_view
```

### Step 3: Update Views to Use Dedup Mat

**outcome_positions_v2:**
```sql
CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16(toInt32OrNull(outcome_index)) AS outcome_idx,
  sum(if(side IN (1, 'YES','BUY','Buy','buy'),  1.0, -1.0) * toFloat64(shares)) AS net_shares
FROM trades_dedup_mat
GROUP BY wallet, market_id, condition_id_norm, outcome_idx
```

**trade_cashflows_v3:**
```sql
CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16(toInt32OrNull(outcome_index)) AS outcome_idx,
  toFloat64(entry_price) AS px,
  toFloat64(shares) AS sh,
  round(
    toFloat64(entry_price) * toFloat64(shares) *
    if(side IN (1, 'YES','BUY','Buy','buy'), -1, 1),
    8
  ) AS cashflow_usdc
FROM trades_dedup_mat
```

---

## 5. REALIZED PnL VIEW (Standalone Fix)

**File:** `/Users/scotty/Projects/Cascadian-app/scripts/fix-realized-pnl-view.ts`

```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx, resolved_at FROM winning_index
)
SELECT
  p.wallet,
  p.market_id,
  p.condition_id_norm,
  w.resolved_at,
  round(
    sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)
    + sum(-toFloat64(c.cashflow_usdc))
  , 4) AS realized_pnl_usd
FROM outcome_positions_v2 p
ANY LEFT JOIN trade_cashflows_v3 c
  ON c.wallet = p.wallet
 AND c.market_id = p.market_id
 AND c.condition_id_norm = p.condition_id_norm
 AND c.outcome_idx = p.outcome_idx
ANY LEFT JOIN win w
  ON lower(replaceAll(w.condition_id_norm,'0x','')) = lower(replaceAll(p.condition_id_norm,'0x',''))
WHERE w.win_idx IS NOT NULL
GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at
```

---

## 6. CRITICAL: migration/clickhouse/016_enhance_polymarket_tables.sql

**File:** `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/016_enhance_polymarket_tables.sql`

This is **WHERE market_id FORMAT IS SET** in the system.

### What It Does:
1. Alters `ctf_token_map` to add market_id column
2. UPDATEs ctf_token_map.market_id from gamma_markets.market_id
3. Creates various enriched views

### The Critical Update (Lines 264-272):

```sql
UPDATE ctf_token_map
SET
  market_id = m.market_id,
  outcome = arrayElement(m.outcomes, outcome_index + 1),
  question = m.question
FROM gamma_markets m
WHERE ctf_token_map.condition_id_norm = m.condition_id;
```

**Problem:** `gamma_markets.market_id` format is **NOT NORMALIZED**
- Could be HEX: "0x123abc..."
- Could be INTEGER: "12345"
- This is where inconsistency is introduced

---

## 7. SCHEMA INSPECTION QUERIES

### Check market_id Format in outcome_positions_v2
```sql
SELECT 
  market_id,
  count(*) AS row_count,
  COUNT(DISTINCT wallet) AS wallet_count,
  -- Check if HEX or INTEGER
  CASE 
    WHEN startsWith(market_id, '0x') THEN 'HEX'
    WHEN market_id ~ '^[0-9]+$' THEN 'INTEGER'
    ELSE 'OTHER'
  END AS format
FROM outcome_positions_v2
GROUP BY market_id
ORDER BY row_count DESC
LIMIT 20;
```

### Check Source Data Format
```sql
-- In erc1155_transfers
SELECT 
  market_id,
  COUNT(*) AS cnt,
  CASE 
    WHEN startsWith(market_id, '0x') THEN 'HEX'
    WHEN market_id ~ '^[0-9]+$' THEN 'INTEGER'
    ELSE 'OTHER'
  END AS format
FROM erc1155_transfers
GROUP BY market_id
LIMIT 20;
```

### Check Token Map
```sql
SELECT 
  market_id,
  COUNT(*) AS tokens,
  CASE 
    WHEN startsWith(market_id, '0x') THEN 'HEX'
    WHEN market_id ~ '^[0-9]+$' THEN 'INTEGER'
    ELSE 'OTHER'
  END AS format
FROM ctf_token_map
WHERE market_id != ''
GROUP BY market_id
LIMIT 20;
```

---

## 8. Critical Execution Order

1. **Create staging tables** → create-transfer-staging-tables.ts
2. **Backfill blockchain data** → step3-streaming-backfill-parallel.ts (2-5 hours)
3. **Flatten ERC1155** → flatten-erc1155.ts
4. **Build proxy mappings** → build-approval-proxies.ts
5. **Run migration** → 016_enhance_polymarket_tables.sql (SETS market_id FORMAT)
6. **[Daily]** Rebuild tables → daily-sync-polymarket.ts

OR alternative:

6. **[Daily]** → build-trades-dedup-mat.ts (uses ReplacingMergeTree instead)

---

## Summary: What Each Script Produces

| Script | Output Table(s) | Type | Duration |
|--------|-----------------|------|----------|
| create-transfer-staging-tables.ts | erc*_staging, checkpoint | Setup | <1s |
| step3-streaming-backfill-parallel.ts | erc*_staging | Data Load | 2-5h |
| flatten-erc1155.ts | pm_erc1155_flats | Transform | 30m |
| build-approval-proxies.ts | pm_user_proxy_wallets | Enrich | 10m |
| 016_enhance_polymarket_tables.sql | ctf_token_map (updated) | Enrich | 5m |
| daily-sync-polymarket.ts | outcome_positions_v2, trade_cashflows_v3 | Rebuild | <5m |
| build-trades-dedup-mat.ts | trades_dedup_mat + views | Alternative | 30m |
| fix-realized-pnl-view.ts | realized_pnl_by_market_final | View | <1m |

