# Pre-computed PnL Tables Plan (Layered Architecture)

## Current Status (Last Updated: 2026-01-12)

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Create Layer 1 table | ✅ Complete | `pm_canonical_fills_v4` - 943M rows |
| 2. Backfill Layer 1 | ✅ Complete | 489M CLOB + 318M CTF + 120M CTF Cash + 15M NegRisk |
| 3. Create Layer 2 (positions) | ✅ Complete | 70.88M positions |
| 4. Create Layer 3 (summary) | ✅ Complete | 1.83M wallets |
| 5. Watermarks + incremental | ✅ Complete | Cron script ready |
| 6. Validate 50 wallets | ✅ Complete | 68% accuracy for realized PnL |

### Validation Results

**Clean Wallets (no NegRisk):** 68% within 10% of API
**All Wallets (random):** 30% within 10% of API

**Root Causes of Discrepancy:**
1. **Open positions (MTM):** API includes mark-to-market for open positions, our formula only calculates realized PnL
2. **NegRisk wallets (44.5%):** Include internal bookkeeping tokens that inflate/deflate PnL

**Recommendation:**
- Use `pm_wallet_summary_v4` for **realized PnL** queries (resolved positions)
- For total PnL including unrealized, fall back to V7 (API)
- Flag wallets with NegRisk activity as "low confidence"

---

## Goal
Reduce PnL query time from **150 seconds** to **<1 second** per wallet, with full audit trail and easy rule changes.

## Architecture Overview

```
Source Tables (693M+ rows)
    │
    ▼ (one-time backfill + incremental with watermarks)
┌─────────────────────────────────────────────────────────┐
│  Layer 1: pm_canonical_fills_v1                         │
│  - Event-level ledger                                   │
│  - V1/V1+ logic baked in (self-fill dedup, NegRisk)    │
│  - Single source of truth                               │
└─────────────────────────────────────────────────────────┘
    │
    ▼ (aggregate)
┌─────────────────────────────────────────────────────────┐
│  Layer 2: pm_wallet_positions_v1                        │
│  - Per (wallet, condition_id, outcome_index)            │
│  - net_tokens, cash_flow, trade_count                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼ (join with resolutions + MTM)
┌─────────────────────────────────────────────────────────┐
│  Layer 3: pm_wallet_summary_v1                          │
│  - Per wallet totals                                    │
│  - realized_pnl, unrealized_pnl, confidence             │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: pm_canonical_fills_v1 (THE KEY TABLE)

This table encodes all V1/V1+ logic at the event level. Once built, batch and per-wallet queries are identical.

### Schema

```sql
CREATE TABLE pm_canonical_fills_v1 (
  -- Event identity
  fill_id String,                    -- Unique: source + event_id
  event_time DateTime,
  block_number UInt64,
  tx_hash String,

  -- Position key
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,

  -- Deltas (the actual ledger entries)
  tokens_delta Float64,              -- Buy: +, Sell: -
  usdc_delta Float64,                -- Buy: -, Sell: +

  -- Source tracking
  source LowCardinality(String),     -- 'clob', 'ctf_token', 'ctf_cash', 'negrisk'

  -- Flags (for debugging and confidence)
  is_self_fill UInt8 DEFAULT 0,      -- Was this tx a self-fill?
  is_maker UInt8 DEFAULT 0,          -- Was this the maker side?

  -- Versioning for ReplacingMergeTree
  _version UInt64 DEFAULT toUnixTimestamp64Milli(now64())

) ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMM(event_time)
ORDER BY (wallet, event_time, condition_id, outcome_index, fill_id)
```

### Canonicalization Rules (baked into build query)

**CLOB fills:**
1. Self-fill detection: Same wallet is maker AND taker in same tx_hash
2. Self-fill handling: DROP the maker leg, KEEP the taker leg
3. tokens_delta: `+amount` for buy, `-amount` for sell
4. usdc_delta: `-amount` for buy, `+amount` for sell

**CTF tokens:**
1. Source: `pm_ctf_split_merge_expanded`
2. tokens_delta: `shares_delta` (already signed)
3. usdc_delta: 0 (token movement only)

**CTF cash:**
1. Insert as separate `ctf_cash` rows at condition level
2. usdc_delta: `sum(cash_delta) / 2` per condition (validated formula)
3. tokens_delta: 0

**NegRisk tokens:**
1. Source: `vw_negrisk_conversions` joined with `pm_negrisk_token_map_v1`
2. tokens_delta: `shares` (inflow to wallet)
3. usdc_delta: 0 (internal bookkeeping)

### Build Query (Initial Backfill)

```sql
INSERT INTO pm_canonical_fills_v1
-- CLOB fills with self-fill dedup
WITH self_fill_txs AS (
  SELECT trader_wallet, transaction_hash
  FROM pm_trader_events_v3
  GROUP BY trader_wallet, transaction_hash
  HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
)
SELECT
  concat('clob_', event_id) as fill_id,
  trade_time as event_time,
  block_number,
  transaction_hash as tx_hash,
  trader_wallet as wallet,
  m.condition_id,
  m.outcome_index,
  CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END as tokens_delta,
  CASE WHEN side = 'buy' THEN -usdc_amount / 1e6 ELSE usdc_amount / 1e6 END as usdc_delta,
  'clob' as source,
  (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs) as is_self_fill,
  role = 'maker' as is_maker
FROM pm_trader_events_v3 t
JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
WHERE m.condition_id != ''
  -- Drop maker leg of self-fills
  AND NOT (
    (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs)
    AND role = 'maker'
  )

UNION ALL

-- CTF token fills
SELECT
  concat('ctf_', toString(block_number), '_', toString(log_index)) as fill_id,
  event_timestamp as event_time,
  block_number,
  tx_hash,
  wallet,
  condition_id,
  outcome_index,
  shares_delta as tokens_delta,
  0 as usdc_delta,
  'ctf_token' as source,
  0 as is_self_fill,
  0 as is_maker
FROM pm_ctf_split_merge_expanded
WHERE condition_id != ''

UNION ALL

-- CTF cash fills (condition-level, /2 formula)
SELECT
  concat('ctf_cash_', condition_id, '_', tx_hash) as fill_id,
  min(event_timestamp) as event_time,
  min(block_number) as block_number,
  tx_hash,
  wallet,
  condition_id,
  0 as outcome_index,  -- Cash is at condition level
  0 as tokens_delta,
  sum(cash_delta) / 2 as usdc_delta,
  'ctf_cash' as source,
  0 as is_self_fill,
  0 as is_maker
FROM pm_ctf_split_merge_expanded
WHERE condition_id != '' AND cash_delta != 0
GROUP BY wallet, condition_id, tx_hash

UNION ALL

-- NegRisk token fills
SELECT
  concat('negrisk_', toString(v.block_number), '_', toString(v.log_index)) as fill_id,
  v.block_timestamp as event_time,
  v.block_number,
  v.tx_hash,
  v.wallet,
  m.condition_id,
  m.outcome_index,
  v.shares as tokens_delta,
  0 as usdc_delta,
  'negrisk' as source,
  0 as is_self_fill,
  0 as is_maker
FROM vw_negrisk_conversions v
JOIN pm_negrisk_token_map_v1 m ON v.token_id_hex = m.token_id_hex
WHERE m.condition_id != ''
```

---

## Layer 2: pm_wallet_positions_v1

Aggregate canonical fills into positions.

### Schema

```sql
CREATE TABLE pm_wallet_positions_v1 (
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,

  -- Aggregated values
  net_tokens Float64,                -- sum(tokens_delta)
  cash_flow Float64,                 -- sum(usdc_delta)

  -- Metadata
  trade_count UInt32,
  first_trade DateTime,
  last_trade DateTime,

  -- Versioning
  _version UInt64 DEFAULT toUnixTimestamp64Milli(now64())

) ENGINE = ReplacingMergeTree(_version)
ORDER BY (wallet, condition_id, outcome_index)
```

### Build Query

```sql
INSERT INTO pm_wallet_positions_v1
SELECT
  wallet,
  condition_id,
  outcome_index,
  sum(tokens_delta) as net_tokens,
  sum(usdc_delta) as cash_flow,
  count() as trade_count,
  min(event_time) as first_trade,
  max(event_time) as last_trade
FROM pm_canonical_fills_v1 FINAL
GROUP BY wallet, condition_id, outcome_index
```

---

## Layer 3: pm_wallet_summary_v1

Final wallet-level PnL with confidence flags.

### Schema

```sql
CREATE TABLE pm_wallet_summary_v1 (
  wallet LowCardinality(String),

  -- PnL
  realized_pnl Float64,
  unrealized_pnl Float64,
  total_pnl Float64,

  -- Position counts
  total_positions UInt32,
  open_positions UInt32,
  resolved_positions UInt32,

  -- Confidence
  confidence LowCardinality(String),  -- 'high', 'medium', 'low'
  confidence_reason String,

  -- Metadata
  last_updated DateTime DEFAULT now(),
  _version UInt64 DEFAULT toUnixTimestamp64Milli(now64())

) ENGINE = ReplacingMergeTree(_version)
ORDER BY (wallet)
```

### Build Query

```sql
INSERT INTO pm_wallet_summary_v1
WITH
  position_pnl AS (
    SELECT
      p.wallet,
      p.condition_id,
      p.outcome_index,
      p.net_tokens,
      p.cash_flow,
      r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
      toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won
    FROM pm_wallet_positions_v1 FINAL p
    LEFT JOIN pm_condition_resolutions r
      ON p.condition_id = r.condition_id AND r.is_deleted = 0
  ),
  wallet_stats AS (
    SELECT
      wallet,
      -- Realized PnL (V1 formula)
      sum(cash_flow) as total_cash,
      sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
      sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses,
      -- Counts
      count() as total_positions,
      countIf(NOT is_resolved) as open_positions,
      countIf(is_resolved) as resolved_positions
    FROM position_pnl
    GROUP BY wallet
  )
SELECT
  wallet,
  round(total_cash + long_wins - short_losses, 2) as realized_pnl,
  0 as unrealized_pnl,  -- TODO: Add MTM calculation
  round(total_cash + long_wins - short_losses, 2) as total_pnl,
  total_positions,
  open_positions,
  resolved_positions,
  'high' as confidence,  -- TODO: Add confidence logic
  '' as confidence_reason
FROM wallet_stats
```

---

## Incremental Updates (Stays Current)

### Watermark Table

```sql
CREATE TABLE pm_ingest_watermarks_v1 (
  source LowCardinality(String),     -- 'clob', 'ctf', 'negrisk'
  last_block_number UInt64,
  last_event_time DateTime,
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (source)
```

### Incremental Strategy

1. **Read watermarks** for each source
2. **Query source tables** where `block_number > watermark - overlap` (30 min overlap for late arrivals)
3. **Insert into canonical fills** with stable fill_id (ReplacingMergeTree handles dedup)
4. **Update watermarks**
5. **Rebuild positions and summary** (fast - just re-aggregate canonical fills)

### Cron Job (every 5 minutes)

```bash
# scripts/cron/update-canonical-fills.ts
# 1. Get watermarks
# 2. Process new CLOB, CTF, NegRisk events
# 3. Insert into pm_canonical_fills_v1
# 4. Update watermarks
# 5. Rebuild pm_wallet_positions_v1
# 6. Rebuild pm_wallet_summary_v1
```

---

## Implementation Order

| Step | Time | Description |
|------|------|-------------|
| 1. Create Layer 1 table | 5 min | `pm_canonical_fills_v1` schema |
| 2. Backfill Layer 1 | 2-4 hr | Full history from all sources |
| 3. Create Layer 2 table | 5 min | `pm_wallet_positions_v1` schema |
| 4. Build Layer 2 | 10 min | Aggregate from canonical fills |
| 5. Create Layer 3 table | 5 min | `pm_wallet_summary_v1` schema |
| 6. Build Layer 3 | 10 min | Join with resolutions |
| 7. Create watermarks | 5 min | `pm_ingest_watermarks_v1` |
| 8. Create incremental job | 1 hr | Cron script for updates |
| 9. Validate on 50 wallets | 5 min | Should match V1 results |

**Steps 1-6 can run overnight.** Step 2 (backfill) is the long one.

---

## Fast PnL Query (After Implementation)

```sql
-- Single wallet: <10ms
SELECT realized_pnl, confidence, confidence_reason
FROM pm_wallet_summary_v1 FINAL
WHERE wallet = '0x...'

-- 50 wallets: <100ms
SELECT wallet, realized_pnl, confidence
FROM pm_wallet_summary_v1 FINAL
WHERE wallet IN (...)

-- 10k wallets for copytrade pool: <1s
SELECT wallet, realized_pnl, total_positions
FROM pm_wallet_summary_v1 FINAL
WHERE confidence = 'high' AND total_positions >= 10
ORDER BY realized_pnl DESC
LIMIT 10000
```

---

## Validation Checklist

After backfill:
- [ ] Pick 10 wallets from original 50-wallet test
- [ ] Query `pm_wallet_summary_v1` for their PnL
- [ ] Compare to API values
- [ ] Should match V1 accuracy (47/50 or better)
- [ ] Query time should be <1 second total

---

## Why This Architecture

1. **Correctness**: V1/V1+ logic encoded once in Layer 1
2. **Auditability**: Can trace any PnL to specific fills
3. **Flexibility**: Change aggregation without re-scanning 693M rows
4. **Speed**: Summary table queries are instant
5. **Router becomes trivial**: Just check confidence flags, not run slow diagnostics
6. **10k copytrade pool**: Finally feasible with clean event-level data
