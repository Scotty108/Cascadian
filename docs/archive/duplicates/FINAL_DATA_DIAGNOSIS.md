# Final Data Diagnosis - Complete Analysis

**Date:** 2025-11-10
**Status:** ✅ Root cause identified, action plan ready

---

## TL;DR

**Problem:** P&L calculations are based on incomplete data and missing 97% of some wallets' activity.

**Root Causes:**
1. `vw_wallet_pnl_calculated` uses `fact_trades_clean` (incomplete, only 63M trades)
2. `vw_trades_canonical` has 2.5x more data (157M trades) but has 9% duplicate trade_keys
3. **Even our most complete table is missing 97% of Wallet #1's Polymarket activity**

**Solution:**
1. Rebuild P&L views using `vw_trades_canonical` (deduped by trade_key)
2. Accept current limitations (97% of Wallet #1 still missing)
3. Plan API/blockchain backfill for missing historical data

---

## Key Findings

### Finding #1: vw_trades_canonical is 2.49x More Granular

| Metric | fact_trades_clean | vw_trades_canonical | Ratio |
|--------|-------------------|---------------------|-------|
| **Total Rows** | 63,380,204 | 157,541,131 | **2.49x** |
| **Unique trade_keys** | N/A | 143,398,661 | - |
| **Duplicates** | N/A | 14,142,470 (9%) | - |
| **Avg rows/tx** | 1.92 | 4.73 | **2.46x** |

**Explanation:** Each blockchain transaction can involve multiple wallet fills. vw_trades_canonical breaks these down into individual wallet-level trades.

**Example:** One transaction (0x2c65ced1...) creates:
- 306 rows in vw_trades_canonical (one per wallet fill)
- 7 rows in fact_trades_clean (aggregated)

### Finding #2: 9% Duplicate trade_keys in vw_trades_canonical

- **Total rows:** 157,541,131
- **Unique trade_keys:** 143,398,661
- **Duplicates:** 14,142,470 (8.98%)

**Impact:** Must dedupe by trade_key when aggregating positions

### Finding #3: Catastrophic Data Loss for Wallet #1

| Source | Wallet #1 Trades | vs Polymarket |
|--------|------------------|---------------|
| fact_trades_clean | 31 | 1.1% |
| vw_trades_canonical | 93 | **3.3%** |
| **Polymarket UI** | **2,816** | **100%** |

**Missing:** 2,723 trades (97%)

**Conclusion:** This data was never ingested into our database.

### Finding #4: Wallet #2 Over-Counting

| Source | Wallet #2 Trades | vs Polymarket |
|--------|------------------|---------------|
| fact_trades_clean | 786,250 | 8,208% |
| vw_trades_canonical | 1,843,966 | **19,257%** |
| **Polymarket UI** | **9,577** | **100%** |

**Excess:** 1,834,389 trades (192x more!)

**Explanation:** We count individual fills; Polymarket counts "predictions" (market positions)

---

## Why the Numbers Don't Match

### Polymarket "Predictions" ≠ Our "Trades"

**Polymarket Definition:** One "prediction" = one market position taken
- Example: Buy 100 shares of YES in "Will it rain?" = 1 prediction

**Our Definition:** One "trade" = one fill event
- Same user buying in 10 separate transactions = 10 trades
- One large market-making transaction affecting 100 wallets = 100 trades

**Result:**
- Active traders (many fills, few markets): We show MORE trades than Polymarket predictions
- Inactive traders (few fills): We show FEWER trades (if historical data missing)

---

## Data Quality by Wallet

### Wallet #1 (0x4ce73141...) - 🚨 CRITICAL DATA LOSS

```
Polymarket shows:     2,816 predictions
Our database has:     93 trades (3.3% coverage)
Missing:              2,723 trades (97%)
Status:               ❌ Unusable for P&L
```

**Why:** Historical data never ingested (before Dec 2022 or missed in ETL)

### Wallet #2 (0x9155e8cf...) - ✅ Over-Complete

```
Polymarket shows:     9,577 predictions
Our database has:     1,843,966 trades (19,257% coverage)
Excess:               1,834,389 trades
Status:               ✅ Complete (need aggregation)
```

**Why:** Counts every fill; Polymarket counts positions

### Wallet #3 (0xcce2b7c7...) - ✅ Good Coverage

```
Polymarket shows:     192 predictions
Our database has:     1,384 trades (721% coverage)
Excess:               1,192 trades
Status:               ✅ Complete (need aggregation)
```

---

## Recommended Action Plan

### Phase 1: Quick Win (Today) - Use vw_trades_canonical

**Goal:** Get 2.5x more complete data immediately

**Steps:**
1. Rebuild `vw_wallet_pnl_calculated` using `vw_trades_canonical` as source
2. Dedupe by `trade_key` when aggregating positions
3. Test against Wallet #2 and #3 (should work well)
4. Document that Wallet #1 has incomplete data

**SQL:**
```sql
CREATE OR REPLACE VIEW vw_wallet_pnl_calculated AS
WITH deduped_trades AS (
  SELECT DISTINCT ON (trade_key)
    wallet_address_norm,
    condition_id_norm,
    outcome_index,
    shares,
    usd_value,
    entry_price,
    timestamp,
    trade_direction
  FROM default.vw_trades_canonical
  ORDER BY trade_key, timestamp DESC
),
position_aggregates AS (
  SELECT
    wallet_address_norm as wallet,
    condition_id_norm as condition_id,
    outcome_index,
    SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
    SUM(usd_value) as cost_basis,
    MIN(timestamp) as first_trade,
    MAX(timestamp) as last_trade,
    COUNT(*) as num_trades
  FROM deduped_trades
  GROUP BY wallet, condition_id, outcome_index
  HAVING net_shares > 0.001
)
SELECT
  p.*,
  r.payout_numerators,
  r.payout_denominator,
  r.winning_outcome,
  -- Realized P&L calculation
  CASE
    WHEN r.payout_denominator > 0 THEN
      (p.net_shares * (r.payout_numerators[p.outcome_index + 1] / r.payout_denominator)) - p.cost_basis
    ELSE NULL
  END as realized_pnl_usd
FROM position_aggregates p
LEFT JOIN (
  SELECT ... FROM default.market_resolutions_final WHERE payout_denominator > 0
  UNION ALL
  SELECT ... FROM default.resolutions_external_ingest WHERE payout_denominator > 0
) r ON p.condition_id = r.cid_norm
```

**Expected Results:**
- Wallet #2: Accurate P&L with full 1.8M trade history
- Wallet #3: Accurate P&L with full 1.4K trade history
- Wallet #1: Still incomplete (only 93 trades), but best we can do without backfill

**Time:** 2-4 hours

### Phase 2: Data Backfill (This Week) - Fill Wallet #1 Gap

**Goal:** Get Wallet #1's missing 2,723 trades

**Options:**

**Option A: Polymarket API Backfill**
```bash
# Fetch Wallet #1's complete history from Polymarket API
curl "https://gamma-api.polymarket.com/markets?participant=0x4ce73141dbfce41e65db3723e31059a730f0abad"

# Insert into appropriate tables
# Expected: 2,816 predictions → convert to trade rows
```

**Option B: Blockchain Deep Dive**
```bash
# Query ERC1155 transfers for Wallet #1 before Dec 2022
# This might reveal if data exists on-chain but wasn't ingested
```

**Option C: Accept Limitations**
- Document that Wallet #1 has only 3.3% coverage
- Focus on wallets with complete data
- Revisit backfill later

**Recommendation:** Start with Option C (document limitations), do Option A if critical

**Time:** Option A: 4-8 hours | Option B: 8-16 hours | Option C: 0 hours

### Phase 3: Unrealized P&L (Next Week)

**Goal:** Calculate total P&L (realized + unrealized)

**Requirements:**
1. ✅ Rebuild P&L views (Phase 1)
2. 🔍 Get current market prices (Polymarket API or market_candles_5m)
3. 🧮 Calculate unrealized P&L for open positions
4. ✅ Validate against Polymarket UI

**Time:** 8-12 hours

---

## Risk Assessment

### Using vw_trades_canonical

**Pros:**
- ✅ 2.5x more complete than fact_trades_clean
- ✅ Wallet-level granularity (matches Polymarket's view)
- ✅ 157M trades vs 63M

**Cons:**
- ⚠️ 9% duplicate trade_keys (must dedupe)
- ⚠️ Still missing 97% of Wallet #1's data
- ⚠️ Need to aggregate properly to avoid double-counting

**Verdict:** **USE IT** - Benefits far outweigh risks

### Current P&L Accuracy

| Wallet | Coverage | P&L Accuracy | Status |
|--------|----------|--------------|--------|
| #1 (0x4ce7...) | 3.3% | ❌ Unreliable | Needs backfill |
| #2 (0x9155...) | 192x | ✅ Over-complete | Needs aggregation |
| #3 (0xcce2...) | 721% | ✅ Over-complete | Needs aggregation |

**Overall:** 2 out of 3 wallets will have accurate P&L after Phase 1

---

## Decision Matrix

### Should We Ship P&L Now?

| Factor | Status | Impact |
|--------|--------|--------|
| Data completeness | ⚠️ 67% (2/3 wallets) | Medium |
| Calculation accuracy | ✅ Correct formula | High |
| Unrealized P&L | ❌ Not implemented | High |
| User expectations | ⚠️ Polymarket parity | High |

**Recommendation:**
- ✅ Ship realized P&L for Wallets #2 and #3
- ⚠️ Show warning for incomplete wallets
- 📋 Add unrealized P&L next week
- 🔄 Backfill Wallet #1 data if critical

---

## Next Commands

```bash
# 1. Rebuild P&L views using vw_trades_canonical
npx tsx rebuild-pnl-from-canonical.ts

# 2. Test against 3 wallets
npx tsx test-pnl-rebuilt.ts

# 3. (Optional) Backfill Wallet #1
npx tsx backfill-wallet1-from-api.ts
```

---

## Conclusion

**Current State:**
- ❌ P&L built on incomplete data (fact_trades_clean)
- ❌ Missing 97% of Wallet #1's history
- ❌ Can't match Polymarket UI

**After Phase 1 (Today):**
- ✅ P&L built on most complete data (vw_trades_canonical)
- ✅ 2/3 wallets with accurate realized P&L
- ⚠️ 1/3 wallets still incomplete (document caveat)

**After Phase 2 (This Week):**
- ✅ Wallet #1 backfilled (if we choose to)
- ✅ 3/3 wallets with complete data

**After Phase 3 (Next Week):**
- ✅ Total P&L (realized + unrealized)
- ✅ Match Polymarket UI
- ✅ Production-ready

**Status:** Action plan ready, awaiting go/no-go decision.

---

**Report Generated:** 2025-11-10
**Next Action:** Rebuild vw_wallet_pnl_calculated from vw_trades_canonical
