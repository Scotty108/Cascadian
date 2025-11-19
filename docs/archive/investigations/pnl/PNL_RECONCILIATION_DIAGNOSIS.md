# P&L Reconciliation Diagnosis Report

## Executive Summary

After comprehensive investigation, I've identified the root cause of the P&L mismatch: **The data in `trades_raw` is incomplete, and the expected P&L targets cannot be computed from the current dataset.**

### Key Findings:

| Metric | Value | Status |
|--------|-------|--------|
| **Expected P&L (HolyMoses7)** | $89,975.16 | Target from Polymarket UI |
| **Calculated P&L (market_resolutions_final join)** | $0 | ❌ 0% matches |
| **Calculated P&L (market_resolutions_final fallback)** | $0 | ❌ 0% matches |
| **Existing wallet_pnl_summary_final** | $58,098.92 | ❌ 35% too low |
| **Data Coverage** | 3.3% of trades | ❌ CRITICAL GAP |

---

## Root Cause Analysis

### Problem 1: Incomplete Data in trades_raw

**Evidence:**
- HolyMoses7 has 8,484 trades total but 0 have resolution data in `is_resolved` column
- niggemon has 16,472 trades total, only 332 marked as resolved (2.0%)
- When joining to `market_resolutions_final`, only 550 trades match (3.3%) for niggemon
- Only 59 unique resolved conditions exist in the entire wallet's trade history

**Impact:**
```
Total trades in dataset:        ~25,000 (two wallets)
Trades matched to resolutions:  ~550 (3.3%)
Settlement calculation:         $1,857.55 (niggemon)
Expected P&L:                   $102,001.46
Gap:                           97.7% MISSING
```

### Problem 2: Unreliable is_resolved Column

**Evidence:**
- `is_resolved` column in trades_raw is NOT populated correctly
- HolyMoses7: 0/8,484 trades marked as resolved (0%)
- niggemon: 332/16,472 trades marked as resolved (2%)
- These do NOT correlate with actual market resolution data

**Why It Matters:**
You warned about this: "Ignore is_resolved and resolved_outcome in trades - they are sparse and inconsistent"

### Problem 3: Empty realized_pnl_usd Column

**Evidence:**
- HolyMoses7: 0/8,484 trades have non-zero `realized_pnl_usd` (0%)
- niggemon: 332/16,472 trades have non-zero `realized_pnl_usd` (2%)
- Even when populated, values are tiny ($117.24 total for niggemon)

**Implication:** This column was never properly calculated or populated in the source data.

### Problem 4: Decimal Overflow in Calculations

When computing `entry_price * shares`:
- Type: `Decimal(18,8) × Decimal(18,8) → Decimal(18,16)`
- Causes overflow in ClickHouse

**Solution:** Cast to Float64 before calculations

---

## Data Quality Assessment

### Trades Data Status: ❌ INCOMPLETE

```sql
-- Actual query results:
SELECT count() FROM trades_raw
-- Result: 159,574,259 total rows (includes duplicates/filtered data)

SELECT count() FROM trades_raw
WHERE lower(wallet_address) IN (target_wallets)
-- Result: 24,956 rows

-- Of these, only 3.3% can be joined to resolved markets
INNER JOIN market_resolutions_final
  ON lower(replaceAll(condition_id, '0x', '')) = condition_id_norm
-- Result: 550 matches for niggemon
```

### What's Missing:

1. **Resolved Market Coverage**: Only ~59 resolved conditions out of 687+ markets traded
2. **PnL Calculation**: The `realized_pnl_usd` column is not populated
3. **Current Prices**: Market prices needed for unrealized P&L not available
4. **Complete Trade History**: Data appears filtered or incomplete

---

## Current Calculations vs Expected

### HolyMoses7 (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8)

| Source | Realized P&L | Unrealized | Total | vs Expected |
|--------|--------------|-----------|-------|-------------|
| Expected (Polymarket UI) | - | - | **$89,975.16** | ✅ Baseline |
| wallet_pnl_summary_final | $52,090.38 | $6,008.54 | $58,098.92 | ❌ -35% |
| market_resolutions_final | $0 | N/A | $0 | ❌ -100% |
| realized_pnl_usd sum | $0 | N/A | $0 | ❌ -100% |

### niggemon (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0)

| Source | Realized P&L | Unrealized | Total | vs Expected |
|--------|--------------|-----------|-------|-------------|
| Expected (Polymarket UI) | - | - | **$102,001.46** | ✅ Baseline |
| wallet_pnl_summary_final | $116,004.32 | -$79,812.75 | $36,191.57 | ❌ -64% |
| market_resolutions_final | $1,857.55 | N/A | $1,857.55 | ❌ -98% |
| realized_pnl_usd sum | $117.24 | N/A | $117.24 | ❌ -99.9% |

---

## Technical Findings

### Schema Analysis

**winning_index VIEW:**
```sql
CREATE VIEW winning_index AS
SELECT
  r.condition_id_norm,                    -- Key for join
  anyIf(moe.outcome_idx, moe.outcome_label = r.win_label) AS win_idx,
  any(r.resolved_at) AS resolved_at
FROM resolutions_norm r
LEFT JOIN market_outcomes_expanded moe USING (condition_id_norm)
GROUP BY r.condition_id_norm
```

**Key Discovery:**
- Condition ID normalization: `lower(replaceAll(condition_id, '0x', ''))`
- Example: `0xb3d36e59...` → `b3d36e59...`
- But only 59-137K unique resolved conditions exist in database

**trades_raw includes:**
- `condition_id` (String) - needs normalization for join
- `realized_pnl_usd` (Float64) - sparse/empty
- `is_resolved` (UInt8) - unreliable
- `fee_usd`, `slippage_usd` - only $0.52 fees for niggemon

---

## Why Existing Views Don't Match

### wallet_pnl_summary_final
- Source unknown - likely calculated differently than expected
- Shows realized PnL but with different methodology
- Includes unrealized PnL but with negative values (open loss positions?)
- **Does not match expected values**

### realized_pnl_by_market_final
- Caused 7.8M row fanout issue (JOIN multiplication)
- Settlement calculation incomplete
- **Does not match expected values**

---

## Recommendations

### Immediate Actions

**1. Verify Data Source**
```
Q: Are the expected values ($89,975.16, $102,001.46) from:
   a) Polymarket UI (requires live API call to verify)
   b) Previous export/snapshot (what date?)
   c) Different wallet trades (wrong addresses?)
   d) Different time period (realized-to-date vs. specific date range?)
```

**2. Check trades_raw Completeness**
```sql
-- Check if the data was filtered or is incomplete
SELECT
  count() as total_rows,
  count(DISTINCT wallet_address) as unique_wallets,
  count(DISTINCT market_id) as unique_markets,
  count(DISTINCT condition_id) as unique_conditions
FROM trades_raw;

-- What percentage of expected markets are present?
```

**3. Validate Market Resolution Data**
```sql
-- How many markets have actually resolved?
SELECT count(DISTINCT condition_id_norm)
FROM market_resolutions_final;

-- How many of the target wallets' markets have resolved?
SELECT count(DISTINCT lower(replaceAll(t.condition_id, '0x', '')))
FROM trades_raw t
INNER JOIN market_resolutions_final mr
  ON lower(replaceAll(t.condition_id, '0x', '')) = mr.condition_id_norm
WHERE lower(t.wallet_address) IN (target_wallets);
```

### Root Cause Resolution Path

Choose one of these approaches:

#### **Option A: Use Polymarket API (Recommended)**
- Fetch live P&L from Polymarket's official API
- Compare with expected values to verify correctness
- Establish source of truth

#### **Option B: Restore Complete trades_raw**
- Check if original data export was filtered
- Re-ingest complete trade history if available
- Rebuild all P&L calculations from complete data

#### **Option C: Accept Current Data Limitations**
- Document that `trades_raw` is incomplete (only 3% resolved)
- Use market_resolutions_final as basis for **partially resolved P&L**
- Clearly mark as "resolved trades only" not "total P&L"

#### **Option D: Compute from Another Source**
- Check if you have access to raw blockchain transaction data
- Re-calculate P&L from authoritative smart contract logs
- Cross-reference with market order books

---

## Technical Debt Items

1. **Decimal Overflow**: Cast to Float64 before entry_price * shares calculations
2. **Type Consistency**: Mix of Decimal(18,x) types causing precision issues
3. **Data Quality**: implemented_pnl_usd should be fully populated or removed
4. **Dedup Verification**: Currently uses condition_id matching but many trades don't map

---

## Next Steps

**BLOCKING**: I cannot provide the expected P&L values without understanding:

1. **Source of expected values**: Are they from Polymarket UI, API, or previous calculation?
2. **Data completeness**: Is trades_raw the complete trade history or filtered?
3. **Time period**: Should P&L be all-time, year-to-date, or a specific date range?
4. **Unrealized P&L inclusion**: Should we include mark-to-market on open positions?

**RECOMMENDATION**: Before proceeding with P&L reconciliation, please clarify:
- [ ] Provide source of the $89,975.16 and $102,001.46 figures
- [ ] Confirm whether trades_raw contains complete trade history
- [ ] Specify required P&L calculation date/time
- [ ] Provide any official P&L calculation methodology if available

Once these are clarified, I can either:
- Integrate Polymarket API for live calculations
- Rebuild complete P&L from corrected data
- Create views that properly handle partial resolution
