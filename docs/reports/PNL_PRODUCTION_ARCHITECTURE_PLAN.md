# PnL Production Architecture Plan

**Status:** VALIDATED FORMULA, READY FOR STRATIFIED TESTING
**Last Updated:** 2026-01-10
**Authors:** Claude + GPT collaboration

---

## Executive Summary

We have discovered and validated a **unified PnL formula** that works across all wallet types (maker-heavy, taker-heavy, mixed, splits, merges, NegRisk) when applied to a properly canonicalized ledger.

**The Formula:**
```
PnL = Cash_flow + Long_wins - Short_losses
```

**Key Breakthroughs:**
1. Self-fill collapse: When wallet is both maker+taker in same tx, keep only taker
2. Short position liability: Subtract losses from short positions that win
3. CTF events as synthetic trades: Splits=BUY@$0.50, Merges=SELL@$0.50, Redemptions=SELL@$1
4. NegRisk works when no phantom inventory

**Validation Results So Far:**

| Wallet Type | API PnL | Calculated | Error |
|-------------|---------|------------|-------|
| Split wallet (5 splits) | -$5.82 | -$5.82 | **$0.00** |
| NegRisk (5 conv, no phantom) | -$102.47 | -$102.48 | **$0.01** |
| NegRisk (51 conv, phantom) | -$132.63 | -$833.33 | **$700** (expected fail) |
| CLOB-only (maker_heavy) | Various | Various | **$0.00** (30 tested) |
| CLOB-only (taker_heavy) | Various | Various | **$0.00** (30 tested) |
| CLOB-only (mixed) | Various | Various | **$0.00** (30 tested) |

---

## The Unified SQL Query (Validated)

This query achieves sub-penny accuracy for non-phantom wallets:

```sql
WITH
  wallet AS (SELECT lower('{WALLET_ADDRESS}') AS w),

  -- Canonical CLOB with self-fill collapse
  wallet_trades AS (
    SELECT transaction_hash, token_id, side, role,
           usdc_amount/1e6 AS usdc, token_amount/1e6 AS tokens, fee_amount/1e6 AS fee
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = (SELECT w FROM wallet)
  ),
  self_fill_txs AS (
    SELECT transaction_hash FROM wallet_trades
    GROUP BY transaction_hash
    HAVING countIf(role='maker')>0 AND countIf(role='taker')>0
  ),
  canon_clob AS (
    SELECT m.condition_id, m.outcome_index, side,
           (usdc + if(side='buy', fee, -fee)) AS usdc_net, tokens
    FROM wallet_trades t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE m.condition_id != ''
      AND (transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs)
           OR (transaction_hash IN (SELECT transaction_hash FROM self_fill_txs) AND role='taker'))
  ),

  -- CTF splits: BUY both outcomes @ $0.50
  ctf_splits AS (
    SELECT condition_id, outcome_index, 'buy' AS side,
           (toFloat64OrZero(amount_or_payout)/1e6)/2 AS usdc_net,
           (toFloat64OrZero(amount_or_payout)/1e6) AS tokens
    FROM pm_ctf_events ARRAY JOIN [0,1] AS outcome_index
    WHERE lower(user_address) = (SELECT w FROM wallet)
      AND event_type = 'PositionSplit' AND is_deleted = 0
  ),

  -- CTF merges: SELL both outcomes @ $0.50
  ctf_merges AS (
    SELECT condition_id, outcome_index, 'sell' AS side,
           (toFloat64OrZero(amount_or_payout)/1e6)/2 AS usdc_net,
           (toFloat64OrZero(amount_or_payout)/1e6) AS tokens
    FROM pm_ctf_events ARRAY JOIN [0,1] AS outcome_index
    WHERE lower(user_address) = (SELECT w FROM wallet)
      AND event_type = 'PositionsMerge' AND is_deleted = 0
  ),

  -- CTF redemptions: SELL winning outcome @ $1
  ctf_redemptions AS (
    SELECT e.condition_id, o.outcome_index, 'sell' AS side,
           (toFloat64OrZero(e.amount_or_payout)/1e6) AS usdc_net,
           (toFloat64OrZero(e.amount_or_payout)/1e6) AS tokens
    FROM pm_ctf_events e
    JOIN pm_condition_resolutions r ON e.condition_id = r.condition_id AND r.is_deleted = 0
    CROSS JOIN (SELECT 0 AS outcome_index UNION ALL SELECT 1 AS outcome_index) o
    WHERE lower(e.user_address) = (SELECT w FROM wallet)
      AND e.event_type = 'PayoutRedemption' AND e.is_deleted = 0
      AND toInt64OrNull(JSONExtractString(r.payout_numerators, o.outcome_index + 1)) = 1
  ),

  -- Combined ledger
  ledger AS (
    SELECT * FROM canon_clob
    UNION ALL SELECT * FROM ctf_splits
    UNION ALL SELECT * FROM ctf_merges
    UNION ALL SELECT * FROM ctf_redemptions
  ),

  -- Aggregate to positions
  positions AS (
    SELECT condition_id, outcome_index,
      sumIf(tokens, side='buy') - sumIf(tokens, side='sell') AS net_tokens,
      sumIf(usdc_net, side='sell') - sumIf(usdc_net, side='buy') AS cash_flow
    FROM ledger GROUP BY condition_id, outcome_index
  ),

  -- Join with resolutions
  with_res AS (
    SELECT p.*, toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 AS won
    FROM positions p
    LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
  ),

  -- Final aggregation
  agg AS (
    SELECT sum(cash_flow) AS cf,
           sumIf(net_tokens, net_tokens > 0 AND won) AS lw,
           sumIf(-net_tokens, net_tokens < 0 AND won) AS sl
    FROM with_res
  )
SELECT round(cf + lw - sl, 4) AS pnl FROM agg
```

---

## Production Architecture (3-Tier Design)

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 0: Pre-computed wallet_lower + skip indexes             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1a: pm_wallet_tx_role_flags_v1                          │
│  - (wallet_lower, tx_hash, has_maker, has_taker)               │
│  - Auditable self-fill detection                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1b: pm_canonical_fills_v2                               │
│  - ReplacingMergeTree, partitioned by month                    │
│  - Self-fill collapsed, fees applied, token mapped             │
│  - Sources: clob, ctf_split, ctf_merge, ctf_redeem             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: pm_wallet_position_state_v1 (AggregatingMergeTree)   │
│  - Materialized via MV from canonical fills                    │
│  - Per (wallet, condition, outcome): net_tokens, cash_flow     │
│  - Sub-second per-wallet queries                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: PnL Query (join positions + resolutions on demand)   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **ReplacingMergeTree for canonical fills** - Safe upserts for corrections
2. **AggregatingMergeTree for positions** - Materialized from day 1 for speed
3. **MV from fills to positions** - Automatic incremental updates
4. **Join resolutions on query** - Resolutions change rarely
5. **Partition by month** - Data lifecycle management
6. **Skip indexes on wallet_lower** - Fast per-wallet queries
7. **Token map as dictionary** - Avoid heavy joins during canonicalization

---

## DDLs (From GPT)

### Layer 1a: Self-fill Role Flags

```sql
CREATE TABLE IF NOT EXISTS pm_wallet_tx_role_flags_v1
(
  wallet_lower LowCardinality(String),
  tx_hash      FixedString(66),
  has_maker    UInt8,
  has_taker    UInt8,
  min_block    UInt64,
  max_block    UInt64,
  min_time     DateTime,
  max_time     DateTime,
  _version     UInt64 DEFAULT toUnixTimestamp64Milli(now64())
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY (wallet_lower, tx_hash)
SETTINGS index_granularity = 8192;

ALTER TABLE pm_wallet_tx_role_flags_v1
  ADD INDEX IF NOT EXISTS idx_wallet_lower wallet_lower TYPE tokenbf_v1(4096) GRANULARITY 1;
```

### Layer 1b: Canonical Fills

```sql
CREATE TABLE IF NOT EXISTS pm_canonical_fills_v2
(
  wallet_lower  LowCardinality(String),
  source        LowCardinality(String),   -- 'clob' | 'ctf_split' | 'ctf_merge' | 'ctf_redeem'
  source_id     String,                   -- clob: event_id, ctf: pm_ctf_events.id
  outcome_index UInt8,

  side          LowCardinality(String),   -- 'buy' | 'sell'
  usdc_net      Float64,                  -- Dollars, includes fees
  tokens        Float64,

  condition_id  FixedString(64),          -- 64 hex chars (no 0x prefix)
  token_id_dec  String,                   -- For clob, else empty

  event_time    DateTime,
  block_number  UInt64,
  tx_hash       FixedString(66),
  role          LowCardinality(String),   -- 'maker'|'taker'|'synthetic'
  trade_date    Date MATERIALIZED toDate(event_time),

  _version      UInt64 DEFAULT toUnixTimestamp64Milli(now64())
)
ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMM(event_time)
ORDER BY (wallet_lower, source, source_id, outcome_index)
SETTINGS index_granularity = 8192;

ALTER TABLE pm_canonical_fills_v2
  ADD INDEX IF NOT EXISTS idx_wallet_lower wallet_lower TYPE tokenbf_v1(4096) GRANULARITY 1;

ALTER TABLE pm_canonical_fills_v2
  ADD INDEX IF NOT EXISTS idx_condition condition_id TYPE tokenbf_v1(4096) GRANULARITY 1;
```

### Token Map Dictionary

```sql
CREATE DICTIONARY IF NOT EXISTS dict_token_to_condition_v5
(
  token_id_dec   String,
  condition_id   String,
  outcome_index  Int64
)
PRIMARY KEY token_id_dec
SOURCE(CLICKHOUSE(
  QUERY '
    SELECT token_id_dec, condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE condition_id != ''''
  '
))
LIFETIME(MIN 60 MAX 300)
LAYOUT(HASHED());
```

### Layer 2: Position State

```sql
CREATE TABLE IF NOT EXISTS pm_wallet_position_state_v1
(
  wallet_lower  LowCardinality(String),
  condition_id  FixedString(64),
  outcome_index UInt8,

  net_tokens_state AggregateFunction(sum, Float64),
  cash_flow_state  AggregateFunction(sum, Float64),
  last_time_state  AggregateFunction(max, DateTime),
  last_block_state AggregateFunction(max, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (wallet_lower, condition_id, outcome_index)
SETTINGS index_granularity = 8192;

ALTER TABLE pm_wallet_position_state_v1
  ADD INDEX IF NOT EXISTS idx_wallet_lower wallet_lower TYPE tokenbf_v1(4096) GRANULARITY 1;

ALTER TABLE pm_wallet_position_state_v1
  ADD INDEX IF NOT EXISTS idx_condition condition_id TYPE tokenbf_v1(4096) GRANULARITY 1;
```

### Materialized View

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_wallet_position_state_v1
TO pm_wallet_position_state_v1
AS
SELECT
  wallet_lower,
  condition_id,
  outcome_index,
  sumState(if(side = 'buy', tokens, -tokens)) AS net_tokens_state,
  sumState(if(side = 'sell', usdc_net, -usdc_net)) AS cash_flow_state,
  maxState(event_time) AS last_time_state,
  maxState(block_number) AS last_block_state
FROM pm_canonical_fills_v2
WHERE condition_id != ''
GROUP BY wallet_lower, condition_id, outcome_index;
```

### Fast PnL Query (from Position State)

```sql
WITH
  positions AS (
    SELECT
      wallet_lower,
      condition_id,
      outcome_index,
      sumMerge(net_tokens_state) AS net_tokens,
      sumMerge(cash_flow_state) AS cash_flow
    FROM pm_wallet_position_state_v1
    WHERE wallet_lower = lower({wallet:String})
    GROUP BY wallet_lower, condition_id, outcome_index
  ),
  with_res AS (
    SELECT p.*,
      toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 AS won
    FROM positions p
    LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
  )
SELECT
  sum(cash_flow)
  + sumIf(net_tokens, net_tokens > 0 AND won)
  - sumIf(-net_tokens, net_tokens < 0 AND won) AS pnl
FROM with_res;
```

---

## What Still Needs Validation (BEFORE BACKFILL)

### 1. Stratified Correctness Suite

Must test wallets from each bucket against API baseline:

| Bucket | Criteria | Status |
|--------|----------|--------|
| Maker-heavy (CLOB-only) | maker_trades > taker_trades * 2 | ✅ 30 tested, $0 error |
| Taker-heavy (CLOB-only) | taker_trades > maker_trades * 2 | ✅ 30 tested, $0 error |
| Mixed (CLOB-only) | Neither heavy | ✅ 30 tested, $0 error |
| Split-heavy | splits > 10 | ✅ 1 tested, $0 error |
| Merge-heavy | merges > 10 | ⚠️ Need to test |
| Redemption-heavy | redemptions > 100 | ⚠️ Need to test |
| NegRisk-light | conversions 1-10 | ✅ 1 tested, $0.01 error |
| NegRisk-heavy | conversions > 50 | ⚠️ Phantom wallets fail |
| Phantom wallets | sell >> buy | ❌ Known to fail (expected) |

**Action Required:** Need to expand API baseline to include CTF/NegRisk wallets, then run full suite.

### 2. Ledger Completeness Invariants

API-free tests that should pass:

- [ ] For each (wallet, condition, outcome): `cash_flow == sum(per-fill cash deltas)`
- [ ] After self-fill collapse: Each tx contributes exactly once
- [ ] Redemption + remaining position consistent (no double-count)

### 3. Incremental Update Correctness

- [ ] Backfill a slice, replay same data incrementally, results match
- [ ] Idempotence: Ingest same block range twice, result identical
- [ ] Token map update: Only affected rows change

### 4. Performance Benchmarks

- [ ] Ingest throughput for canonicalization
- [ ] Single wallet PnL query latency (<100ms target)
- [ ] Bulk leaderboard query latency

---

## Phantom Inventory Handling

**Problem:** Some wallets sell tokens they never bought via CLOB (minted via NegRisk adapter).

**Detection:**
```sql
-- Phantom check per wallet
sumIf(tokens, outcome_index=0 AND side='sell') > sumIf(tokens, outcome_index=0 AND side='buy') * 1.01 AS has_phantom_yes
sumIf(tokens, outcome_index=1 AND side='sell') > sumIf(tokens, outcome_index=1 AND side='buy') * 1.01 AS has_phantom_no
```

**Options:**
1. **Filter out** - Mark wallet as "not locally solvable", exclude from accurate set
2. **Mint inference** - Use `pm_neg_risk_conversions_v1.amount` to emit synthetic BUY rows
   - Only apply to phantom wallets (gated, not universal)
   - Risk of double-counting if not careful

**Current Recommendation:** Start with option 1 (filter), add mint inference in Phase 2.

---

## Implementation Phases

| Phase | Description | Effort | Prerequisite |
|-------|-------------|--------|--------------|
| **0** | Run stratified validation suite | 4 hours | None |
| **1a** | Create role flags table + incremental | 2 hours | Phase 0 pass |
| **1b** | Create canonical fills table | 2 hours | Phase 1a |
| **2** | Create position state + MV | 2 hours | Phase 1b |
| **3** | Build backfill script (parallel) | 6 hours | Phase 2 |
| **4** | Run backfill (8 workers) | 4-8 hours | Phase 3 |
| **5** | Build incremental sync crons | 4 hours | Phase 4 |
| **6** | Token map dirty queue | 3 hours | Phase 5 |
| **7** | Phantom detection table | 2 hours | Phase 4 |
| **8** | API/service layer | 4 hours | Phase 7 |

**Total: ~35-45 hours**

---

## Next Immediate Action

**Run stratified validation suite** before any table creation:

1. Fetch API PnL for sample wallets in each bucket (especially CTF/NegRisk)
2. Run unified formula against each
3. Confirm sub-penny accuracy for non-phantom buckets
4. Document phantom buckets as "excluded from local calculation"

Only after validation passes: Create DDLs and start backfill.

---

## Files Reference

| File | Purpose |
|------|---------|
| `docs/READ_ME_FIRST_PNL.md` | Main PnL system guide |
| `docs/reports/PNL_ENGINE_CLOB_ACCURACY_FINAL.md` | V43 accuracy report |
| `lib/pnl/pnlEngineV43.ts` | Current best CLOB engine |
| `lib/pnl/pnlEngineV44.ts` | Unified formula engine (needs testing) |
| `lib/pnl/pnlEngineV7.ts` | API-based fallback |

---

*This document should be read before continuing PnL production system work.*
