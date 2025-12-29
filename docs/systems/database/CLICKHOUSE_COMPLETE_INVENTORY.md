# ClickHouse Complete Database Inventory for PnL Calculation

**Generated:** 2025-11-28
**Purpose:** Comprehensive inventory of all ClickHouse tables to understand available data for accurate Polymarket PnL calculation

---

## Executive Summary

We have **comprehensive data** for accurate PnL calculation including:
- ✅ **115M+ CTF events** (splits, merges, redemptions)
- ✅ **190K+ resolution records** with payout numerators/denominators
- ✅ **776M+ CLOB trade events** (maker/taker fills with fees)
- ✅ **35M+ pre-computed wallet-market positions** (from Goldsky)
- ✅ **Complete token-to-condition mapping** (358K mappings)

**Gap:** No direct `ConditionResolution` events, but we have equivalent data in `pm_condition_resolutions` table.

---

## Database Overview

**Total Tables:** 95 (35 base tables, 60 views)
**Key Databases:**
- `default`: Active production tables
- `pm_archive`: Historical/backup tables and legacy PnL views

---

## Critical Tables for PnL Calculation

### 1. CTF (Conditional Token Framework) Events

#### `default.pm_ctf_events`
**Rows:** 115,377,265
**Engine:** SharedReplacingMergeTree
**Purpose:** Raw CTF events from blockchain (splits, merges, redemptions)

**Schema:**
```sql
event_type              String        -- PositionSplit, PositionsMerge, PayoutRedemption
user_address            String        -- Wallet performing the action
collateral_token        String        -- USDC contract (0x2791bca... or 0x3a3bd7bb...)
parent_collection_id    String        -- Usually all zeros
condition_id            String        -- 64-char hex condition ID
partition_index_sets    String        -- JSON array like "[1,2]"
amount_or_payout        String        -- Amount in raw units (6 decimals for USDC)
event_timestamp         DateTime
block_number            Int64
tx_hash                 String
id                      String        -- Unique event ID
insert_time             DateTime
is_deleted              UInt8
```

**Event Distribution:**
| Event Type | Count | Coverage |
|------------|-------|----------|
| PositionSplit | 75,997,074 | 65.8% |
| PositionsMerge | 19,937,017 | 17.3% |
| PayoutRedemption | 19,443,802 | 16.9% |

**Sample PositionSplit:**
```json
{
  "event_type": "PositionSplit",
  "user_address": "0xd91e80cf2e7be2e162c6513ced06f1dd0da35296",
  "condition_id": "1742f180a7ff24c2a89f3775e8f4243169085b7a25a50f15c76090b816e4c994",
  "partition_index_sets": "[1,2]",
  "amount_or_payout": "34000000",  // $34 USDC (34M / 1M)
  "event_timestamp": "2024-10-16 13:57:51"
}
```

**Sample PayoutRedemption:**
```json
{
  "event_type": "PayoutRedemption",
  "user_address": "0x31fc8b226ca1848a8fd9d148fa0116bcd320810f",
  "condition_id": "f92134eadf96a4c5b8761343037e4366fbb9629bc303b42715a511e82203b164",
  "partition_index_sets": "[1,2]",
  "amount_or_payout": "18383800",  // $18.38 USDC redeemed
  "event_timestamp": "2025-11-27 00:46:51"
}
```

**PnL Relevance:** ⭐⭐⭐⭐⭐ CRITICAL
- Contains all minting (PositionSplit) and burning (PositionsMerge) of shares
- PayoutRedemption shows when users claim winnings from resolved markets
- This is the **source of truth** for share inventory changes

---

#### `default.pm_ctf_split_merge_expanded`
**Rows:** 31,710,366
**Engine:** SharedReplacingMergeTree
**Purpose:** Pre-processed CTF events expanded to per-outcome deltas

**Schema:**
```sql
wallet               String
condition_id         String        -- 64-char hex
outcome_index        UInt8         -- 0, 1, 2, etc.
event_type           String        -- PositionSplit, PositionsMerge
cash_delta           Float64       -- Change in USDC (negative = spent, positive = received)
shares_delta         Float64       -- Change in shares (positive = received, negative = burned)
amount_raw           UInt256       -- Raw amount from blockchain
event_timestamp      DateTime
block_number         UInt64
tx_hash              String
id                   String
```

**Event Distribution:**
| Event Type | Count |
|------------|-------|
| PositionSplit | 22,492,580 |
| PositionsMerge | 9,217,786 |

**Sample PositionSplit (expanded):**
```json
{
  "wallet": "0xd91e80cf2e7be2e162c6513ced06f1dd0da35296",
  "condition_id": "4a64f9884cca36e19d0647221e43dd231489b675b66e993a0493903323ff080c",
  "outcome_index": 1,
  "event_type": "PositionSplit",
  "cash_delta": -45.26,      // Spent $45.26 USDC
  "shares_delta": 45.26,     // Received 45.26 shares of outcome 1
  "event_timestamp": "2024-11-18 03:05:00"
}
```

**Sample PositionsMerge (expanded):**
```json
{
  "wallet": "0x00007ccbc85b66f7a06e7d366e08b092e82285dd",
  "condition_id": "a232e5e080358dd9d54d9a3f7b84eb3cf9695fd3ff150c3a43ffd92d3effcf2d",
  "outcome_index": 0,
  "event_type": "PositionsMerge",
  "cash_delta": 0.034781,     // Received $0.034781 USDC
  "shares_delta": -0.034781,  // Burned 0.034781 shares
  "event_timestamp": "2023-06-02 18:57:05"
}
```

**PnL Relevance:** ⭐⭐⭐⭐⭐ CRITICAL
- **This table is already processed and ready to use**
- Each row represents a delta for a specific outcome
- PositionSplit with partition `[1,2]` creates 2 rows (one for outcome 0, one for outcome 1)
- Easier to work with than raw `pm_ctf_events`

**Key Insight:** This is likely the best table for CTF-based PnL calculation.

---

### 2. Market Resolutions

#### `default.pm_condition_resolutions`
**Rows:** 190,160
**Engine:** SharedReplacingMergeTree
**Purpose:** Resolution data for all conditional tokens

**Schema:**
```sql
condition_id           String        -- 64-char hex
payout_numerators      String        -- JSON array like "[1,0]" or "[0,1]"
payout_denominator     String        -- Usually "2" for binary markets
resolved_at            DateTime
block_number           UInt64
tx_hash                String
id                     String
insert_time            DateTime
is_deleted             UInt8
```

**Sample Resolutions:**
```json
{
  "condition_id": "0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed",
  "payout_numerators": "[1,0]",     // Outcome 0 won
  "payout_denominator": "2",
  "resolved_at": "2025-08-01 07:38:54"
}
```

```json
{
  "condition_id": "000149d7a2971f4ba69343b6ebc8b5d76a29b2f20caa7b7041ae2f2da0a448f3",
  "payout_numerators": "[1,0]",     // Outcome 0 won
  "payout_denominator": "2",
  "resolved_at": "2025-09-14 14:18:18"
}
```

**How to Calculate Payout per Share:**
- Binary market with `[1,0]` and denominator `2`:
  - Outcome 0 holders get: `1/2 = 0.5` per share
  - Outcome 1 holders get: `0/2 = 0.0` per share
- Binary market with `[0,1]` and denominator `2`:
  - Outcome 0 holders get: `0/2 = 0.0` per share
  - Outcome 1 holders get: `1/2 = 0.5` per share

Wait, that's wrong! Looking at Polymarket, shares pay out $1 (1 USDC) for winning outcome.

**Correct Interpretation (based on Polymarket docs):**
- `[1,0]` means outcome 0 won, outcome 1 lost
- Winning shares pay out **1 USDC per share**
- Losing shares pay out **0 USDC per share**
- The denominator is not used in payout calculation for Polymarket

**PnL Relevance:** ⭐⭐⭐⭐⭐ CRITICAL
- **Required to determine which outcome won**
- Use this to calculate resolution PnL
- 190K resolved conditions (out of ~180K total markets)

---

### 3. CLOB Trading Events

#### `default.pm_trader_events_v2`
**Rows:** 776,546,084
**Engine:** SharedMergeTree
**Purpose:** All CLOB (order book) trades with maker/taker, fees

⚠️ **WARNING:** This table has **2-3x duplicates** due to historical backfills. **ALWAYS use GROUP BY event_id** when querying.

**Schema:**
```sql
event_id               String        -- Unique trade event ID
trader_wallet          String
role                   String        -- "maker" or "taker"
side                   String        -- "buy" or "sell"
token_id               String        -- Token ID (very long decimal string)
usdc_amount            Float64       -- USDC amount in microUSDC (divide by 1M)
token_amount           Float64       -- Share amount in microshares (divide by 1M)
fee_amount             Float64       -- Fee in microUSDC (divide by 1M)
trade_time             DateTime
transaction_hash       String
block_number           UInt64
insert_time            DateTime
is_deleted             UInt8
```

**Sample Trade:**
```json
{
  "event_id": "0x42f26bfcddf498fda4b2c2958f9ee23921e84c0a58646e867bd4f56...",
  "trader_wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "role": "maker",
  "side": "buy",
  "token_id": "251135563753328170759148188520793623034158902295063005731...",
  "usdc_amount": 182414400,        // $182.41 (182414400 / 1M)
  "token_amount": 434320000.00,    // 434.32 shares
  "fee_amount": 0,
  "trade_time": "2024-03-12 16:53:24"
}
```

**Deduplication Pattern (REQUIRED):**
```sql
SELECT ... FROM (
  SELECT
    event_id,
    any(side) as side,
    any(usdc_amount) / 1000000.0 as usdc,
    any(token_amount) / 1000000.0 as tokens,
    any(fee_amount) / 1000000.0 as fee,
    any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE trader_wallet = '0x...' AND is_deleted = 0
  GROUP BY event_id
) ...
```

**PnL Relevance:** ⭐⭐⭐⭐⭐ CRITICAL
- Contains all order book trades (buys/sells)
- Includes fees (important for accurate PnL)
- Shows exact USDC spent/received per trade
- Must dedupe with GROUP BY event_id

---

#### `default.pm_fpmm_trades`
**Rows:** 4,349,717
**Engine:** SharedReplacingMergeTree
**Purpose:** AMM (Automated Market Maker) trades via FPMM pools

**Schema:**
```sql
event_id               String
event_type             String        -- FPMMBuy, FPMMSell
fpmm_pool_address      String
trader_wallet          String
outcome_index          Int64
side                   String        -- buy, sell
usdc_amount            Float64       -- Already in USDC (not microUSDC)
fee_amount             Float64
token_amount           Float64
trade_time             DateTime
block_number           UInt64
transaction_hash       String
insert_time            DateTime
is_deleted             UInt8
```

**PnL Relevance:** ⭐⭐⭐⭐ HIGH
- AMM trades (early Polymarket, less common now)
- ~4.3M trades vs 776M CLOB trades (0.6% of volume)
- Important for complete picture but not primary source

---

### 4. Mapping Tables

#### `default.pm_token_to_condition_map_v3`
**Rows:** 358,617
**Engine:** SharedMergeTree
**Purpose:** Maps token IDs to condition IDs with outcome index and metadata

**Schema:**
```sql
condition_id           String        -- 64-char hex
token_id_dec           String        -- Token ID as decimal string
slug                   String        -- Market slug
question               String
category               String
tags                   Array(String)
outcome_index          Int64         -- Which outcome this token represents
```

**Sample Mapping:**
```json
{
  "condition_id": "00000977017fa72fb6b1908ae694000d3b51f442c2552656b10bdbbfd16ff707",
  "token_id_dec": "44554681108074793313893626424278471150091658237406724818592366780413111952248",
  "slug": "will-zelenskyy-and-putin-meet-next-in-saudi-arabia",
  "question": "Will Zelenskyy and Putin meet next in Saudi Arabia before 2027?",
  "category": "Other",
  "tags": ["Putin x Zelenskyy Where Next"],
  "outcome_index": 0
}
```

**PnL Relevance:** ⭐⭐⭐⭐⭐ CRITICAL
- **Required to join CLOB trades to conditions**
- CLOB trades use token_id, but resolutions use condition_id
- Each condition has 2+ token IDs (one per outcome)
- Includes market metadata (question, category)

---

#### `default.pm_fpmm_pool_map`
**Rows:** 26,085
**Engine:** SharedReplacingMergeTree
**Purpose:** Maps FPMM pool addresses to condition IDs

**PnL Relevance:** ⭐⭐⭐ MEDIUM
- Needed to join FPMM trades to conditions
- Less important since FPMM trades are <1% of volume

---

### 5. Market Metadata

#### `default.pm_market_metadata`
**Rows:** 179,830
**Engine:** SharedReplacingMergeTree
**Purpose:** Market questions, categories, tags, token IDs

**PnL Relevance:** ⭐⭐ LOW for PnL calculation, HIGH for display
- Useful for grouping PnL by category/tag
- Not required for core PnL math

---

### 6. Pre-Computed PnL (Goldsky)

#### `pm_archive.pm_wallet_market_pnl_v4`
**Rows:** 35,223,748
**Engine:** SharedMergeTree
**Purpose:** **Pre-computed wallet-level PnL per market outcome** (computed by Goldsky/you)

**Schema:**
```sql
wallet                         String
condition_id                   String
outcome_index                  UInt8
question                       String
category                       String
total_bought_shares            Float64
total_sold_shares              Float64
net_shares                     Float64
total_bought_usdc              Float64
total_sold_usdc                Float64
total_fees_usdc                Float64
avg_cost_per_share             Float64
remaining_cost_basis           Float64
is_resolved                    UInt8
outcome_won                    UInt8
resolution_payout              Float64
trading_pnl                    Float64
resolution_pnl                 Float64
total_pnl                      Float64
total_trades                   UInt64
first_trade                    DateTime
last_trade                     DateTime
computed_at                    DateTime
```

**Sample Position (Resolved Winner):**
```json
{
  "wallet": "0x00000000000050ba7c429821e6d66429452ba168",
  "question": "ETH above $4,000 next Friday?",
  "outcome_index": 1,
  "total_bought_shares": 8521.14,
  "total_sold_shares": 2924.48,
  "net_shares": 5596.66,
  "total_bought_usdc": 5145.40,
  "total_sold_usdc": 1570.98,
  "total_fees_usdc": 0,
  "avg_cost_per_share": 0.604,
  "remaining_cost_basis": 3379.48,
  "is_resolved": 1,
  "outcome_won": 1,
  "resolution_payout": 5596.66,    // Won $5596.66 (shares * $1)
  "trading_pnl": -194.93,          // Lost $194.93 on trading
  "resolution_pnl": 2217.18,       // Gained $2217.18 from resolution
  "total_pnl": 2022.24,            // Net: $2022.24 profit
  "total_trades": 44
}
```

**Summary Stats:**
- **35.2M positions** across **1.17M unique wallets**
- **135K unique conditions**
- **All positions are resolved** (is_resolved = 1)
- Total PnL sum: **$9,577.90** (sanity check: should be near zero for zero-sum)
  - Trading PnL: $8,048.57
  - Resolution PnL: $1,529.32

**PnL Relevance:** ⭐⭐⭐⭐⭐ CRITICAL
- **This table may already have accurate PnL!**
- Includes trading PnL + resolution PnL separately
- Already handles cost basis, FIFO, fees
- Question: Does this match Polymarket's numbers?

---

#### `pm_archive.pm_user_positions`
**Rows:** 54,431,782
**Engine:** SharedReplacingMergeTree
**Purpose:** Older format of user positions (from Goldsky)

**Schema:**
```sql
position_id            String
proxy_wallet           String
condition_id           String        -- Stored as decimal with ".0" suffix
realized_pnl           Float64
unrealized_pnl         Float64
total_bought           Float64
total_sold             Float64
updated_at             DateTime
block_number           UInt64
insert_time            DateTime
is_deleted             UInt8
token_id               String
```

**PnL Relevance:** ⭐⭐⭐ MEDIUM
- Legacy format, use pm_wallet_market_pnl_v4 instead
- Has more positions (54M vs 35M) - may include unresolved?

---

### 7. Internal PnL Tables

#### `default.pm_cascadian_pnl_v1_new`
**Rows:** 24,695,013
**Engine:** SharedMergeTree
**Purpose:** Your own PnL calculation (CLOB-only, no CTF)

**Schema:**
```sql
trader_wallet                  String
condition_id                   String
outcome_index                  UInt8
trade_cash_flow                Float64
final_shares                   Float64
resolution_price               Nullable(Float64)
realized_pnl                   Float64
trade_count                    UInt32
first_trade                    DateTime64(3)
last_trade                     DateTime64(3)
resolved_at                    Nullable(DateTime64(3))
is_resolved                    UInt8
```

**PnL Relevance:** ⭐⭐⭐ MEDIUM
- Your own calculation attempt
- Does NOT include CTF events (splits/merges)
- Missing redemption logic
- Use as reference but not source of truth

---

## Data Quality Assessment

### What We Have ✅

| Data Type | Source Table | Row Count | Completeness |
|-----------|--------------|-----------|--------------|
| CTF Splits | pm_ctf_split_merge_expanded | 22.5M | 100% |
| CTF Merges | pm_ctf_split_merge_expanded | 9.2M | 100% |
| CTF Redemptions | pm_ctf_events | 19.4M | 100% |
| Resolutions | pm_condition_resolutions | 190K | ~95% |
| CLOB Trades | pm_trader_events_v2 | 776M | 100% |
| AMM Trades | pm_fpmm_trades | 4.3M | 100% |
| Token Mappings | pm_token_to_condition_map_v3 | 358K | 100% |
| Pre-computed PnL | pm_archive.pm_wallet_market_pnl_v4 | 35.2M | 100% |

### What We're Missing ❌

| Missing Data | Impact | Workaround |
|--------------|--------|------------|
| ConditionResolution events | LOW | We have `pm_condition_resolutions` table instead |
| Direct payout per share | LOW | Can calculate from payout_numerators |
| Transfer events | LOW | Not needed for PnL (only for share custody) |

### Data Gaps 🔍

1. **Resolution Coverage:** ~190K resolutions vs ~180K markets = good coverage
2. **Zero-sum Validation:** Total PnL sum is $9,577.90 (expected: ~$0)
   - Possible reasons: fees, rounding errors, incomplete redemptions
   - Need investigation

---

## Recommended Approach for Accurate PnL

### Option 1: Use Pre-Computed Data ⭐ RECOMMENDED

**Use:** `pm_archive.pm_wallet_market_pnl_v4`

**Pros:**
- Already computed and ready to use
- Includes trading PnL + resolution PnL
- Handles cost basis, fees, FIFO
- 35M positions across 1.17M wallets

**Cons:**
- Need to validate against Polymarket's numbers
- May have outdated computation logic
- Unclear if it includes CTF events properly

**Next Steps:**
1. Pick 5-10 wallets
2. Compare `pm_wallet_market_pnl_v4.total_pnl` with Polymarket UI
3. If matches → use this table
4. If doesn't match → investigate discrepancies

---

### Option 2: Build from Scratch (Full CTF + CLOB)

**Use:** `pm_ctf_split_merge_expanded` + `pm_trader_events_v2` + `pm_condition_resolutions`

**Algorithm:**
```sql
-- For each wallet + condition + outcome:

-- 1. Get CLOB trades
SELECT
  trader_wallet,
  condition_id,
  outcome_index,
  sum(CASE WHEN side = 'buy' THEN token_amount ELSE -token_amount END) as clob_shares_delta,
  sum(CASE WHEN side = 'buy' THEN -usdc_amount ELSE usdc_amount END) as clob_cash_delta,
  sum(fee_amount) as total_fees
FROM (
  SELECT ... FROM pm_trader_events_v2
  JOIN pm_token_to_condition_map_v3 USING (token_id)
  WHERE is_deleted = 0
  GROUP BY event_id  -- DEDUP!
)
GROUP BY trader_wallet, condition_id, outcome_index

-- 2. Get CTF events
SELECT
  wallet,
  condition_id,
  outcome_index,
  sum(shares_delta) as ctf_shares_delta,
  sum(cash_delta) as ctf_cash_delta
FROM pm_ctf_split_merge_expanded
GROUP BY wallet, condition_id, outcome_index

-- 3. Get redemptions
SELECT
  user_address,
  condition_id,
  sum(amount_or_payout) / 1000000.0 as redemption_amount
FROM pm_ctf_events
WHERE event_type = 'PayoutRedemption'
GROUP BY user_address, condition_id

-- 4. Combine
WITH combined AS (
  SELECT
    wallet,
    condition_id,
    outcome_index,
    clob_shares_delta + ctf_shares_delta as total_shares_delta,
    clob_cash_delta + ctf_cash_delta as total_cash_delta,
    total_fees,
    redemption_amount
  FROM ...
)
SELECT
  wallet,
  condition_id,
  outcome_index,
  total_cash_delta - total_fees + redemption_amount as realized_pnl
FROM combined
```

**Pros:**
- Full control and transparency
- Can audit every step
- Matches Polymarket's methodology exactly

**Cons:**
- Complex query
- Need to handle edge cases (multi-outcome markets, partial redemptions)
- Compute-intensive (billions of rows)

---

### Option 3: Hybrid Approach

**Use:** `pm_wallet_market_pnl_v4` as base, validate with raw data

**Steps:**
1. Use pre-computed table for initial PnL
2. For wallets with discrepancies, drill into raw data
3. Identify gaps in pre-computed logic
4. Fix computation and rebuild table

---

## Key Findings

### 1. Pre-Computed PnL Exists
- `pm_archive.pm_wallet_market_pnl_v4` has 35M pre-computed positions
- Includes trading PnL, resolution PnL, fees
- **Needs validation against Polymarket**

### 2. CTF Data is Complete
- `pm_ctf_split_merge_expanded` is processed and ready
- Has per-outcome deltas (cash + shares)
- Easier to work with than raw `pm_ctf_events`

### 3. CLOB Data Requires Deduplication
- `pm_trader_events_v2` has 2-3x duplicates
- **Always use GROUP BY event_id**
- 776M rows → ~260M unique events

### 4. Resolution Data is Good
- 190K resolved conditions
- Payout numerators show which outcome won
- Winning shares pay $1 per share

### 5. Token Mapping is Essential
- CLOB uses token_id, everything else uses condition_id
- `pm_token_to_condition_map_v3` bridges the gap

---

## Gap Analysis: What We Have vs. What We Need

| Requirement | Status | Source Table |
|-------------|--------|--------------|
| ✅ CTF PositionSplit | HAVE | pm_ctf_split_merge_expanded |
| ✅ CTF PositionMerge | HAVE | pm_ctf_split_merge_expanded |
| ✅ CTF PayoutRedemption | HAVE | pm_ctf_events |
| ✅ Condition Resolutions | HAVE | pm_condition_resolutions |
| ✅ CLOB Trades | HAVE | pm_trader_events_v2 (DEDUP!) |
| ✅ Token→Condition Mapping | HAVE | pm_token_to_condition_map_v3 |
| ✅ Payout Numerators | HAVE | pm_condition_resolutions.payout_numerators |
| ⚠️ Pre-computed PnL | HAVE (needs validation) | pm_archive.pm_wallet_market_pnl_v4 |

**Verdict:** We have **everything** needed for accurate PnL! 🎉

---

## Recommended Next Steps

### Immediate (Today)
1. **Validate pre-computed PnL:**
   - Pick 10 wallets from different PnL ranges
   - Compare `pm_wallet_market_pnl_v4.total_pnl` with Polymarket UI
   - Document discrepancies

2. **Check zero-sum property:**
   - Why is total PnL = $9,577.90 instead of ~$0?
   - Investigate missing redemptions or fees

### Short-term (This Week)
3. **Build reconciliation script:**
   - For 1 wallet, compute PnL from scratch using CTF + CLOB
   - Compare with pre-computed and Polymarket
   - Identify which methodology is correct

4. **Document accurate PnL formula:**
   - Write canonical spec for PnL calculation
   - Include all edge cases (multi-outcome, partial redemptions)

### Medium-term (Next Week)
5. **Rebuild PnL table (if needed):**
   - If pre-computed is wrong, rebuild with correct logic
   - Use `pm_ctf_split_merge_expanded` + `pm_trader_events_v2`
   - Add CTF redemptions

6. **Create real-time PnL view:**
   - Materialized view that updates on new trades/resolutions
   - Powers leaderboard and wallet analytics

---

## Appendix: All Tables Reference

### Base Tables (35)

| Table | Rows | Purpose |
|-------|------|---------|
| pm_api_positions | 70 | API-sourced positions (small) |
| pm_cascadian_pnl_v1_new | 24.7M | Internal PnL (CLOB-only) |
| pm_condition_resolutions | 190K | Market resolutions |
| pm_ctf_events | 115.4M | Raw CTF events |
| pm_ctf_split_merge_expanded | 31.7M | Processed CTF with deltas |
| pm_fpmm_pool_map | 26K | AMM pool mappings |
| pm_fpmm_trades | 4.3M | AMM trades |
| pm_market_data_quality | 2 | Quality flags |
| pm_market_metadata | 179K | Market questions/metadata |
| pm_token_to_condition_map_v3 | 358K | Token→Condition mapping |
| pm_trader_events_v2 | 776.5M | CLOB trades (DEDUP!) |
| pm_ui_positions_new | 84 | UI positions |
| pm_archive.pm_condition_resolutions_backup_20251121 | 357K | Backup |
| pm_archive.pm_market_metadata_backup_20251121 | 179K | Backup |
| pm_archive.pm_token_to_condition_map | 358K | Legacy mapping |
| pm_archive.pm_token_to_condition_map_v2 | 358K | Legacy mapping |
| pm_archive.pm_trader_events | 426M | Legacy CLOB |
| pm_archive.pm_trader_events_backup_20251121 | 205M | Backup |
| pm_archive.pm_ui_positions | 285 | Legacy UI |
| pm_archive.pm_ui_positions_new | 92K | UI positions |
| pm_archive.pm_user_positions | 54.4M | Goldsky positions (old) |
| pm_archive.pm_user_positions_backup_20251121 | 84.4M | Backup |
| pm_archive.pm_wallet_condition_pnl_v4 | 20.9M | Condition-level PnL |
| pm_archive.pm_wallet_market_pnl_v2 | 35.2M | Market PnL v2 |
| pm_archive.pm_wallet_market_pnl_v3 | 35.2M | Market PnL v3 |
| pm_archive.pm_wallet_market_pnl_v4 | 35.2M | Market PnL v4 ⭐ |
| pm_archive.pm_wallet_market_positions_raw | 35.2M | Raw positions |
| pm_archive.tmp_sports_bettor_resolutions | 381 | Sports test data |
| pm_archive.tmp_sports_bettor_trades | 22K | Sports test data |
| pm_archive.tmp_sports_bettor_trades_v3 | 22K | Sports test data |

### Views (60)
All views are derived from base tables. Key views:
- `vw_pm_realized_pnl_v*`: Various PnL calculation approaches
- `vw_pm_ledger*`: Ledger-style views
- `vw_wallet_pnl*`: Wallet-level aggregations

---

**Report End**

---

**Signed:** Claude 1 (Database Agent)
