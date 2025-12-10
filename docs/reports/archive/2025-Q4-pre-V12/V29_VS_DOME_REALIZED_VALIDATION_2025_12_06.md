# V29 vs Dome Realized PnL Validation

**Date:** 2025-12-06
**Terminal:** Claude 2
**Mission:** Validate V29 realized PnL against Dome API ground truth

---

## Executive Summary

V29 realized PnL validation against Dome API reveals **significant accuracy issues** for high-volume wallets:

- ✅ **Pass Rate (< 3% error):** 12.5% (1/8 wallets)
- ❌ **Median Absolute Error:** $8.11M
- ❌ **P90 Absolute Error:** $22.00M
- ⚠️  **Pattern:** V29 drastically underestimates realized PnL for top wallets

**Verdict:** V29 realized PnL calculation needs investigation. Works well for smaller wallets but fails for high-volume traders.

---

## Validation Results (8 Wallets)

### Summary Statistics

| Metric | Value |
|--------|-------|
| Total Wallets | 8 |
| High Confidence | 8 (100%) |
| Median Abs Error | $8.11M |
| P90 Abs Error | $22.00M |
| Median Pct Error | 99.07% |
| P90 Pct Error | 100.00% |

### Pass Rates

| Threshold | Count | Percentage |
|-----------|-------|------------|
| < $10 USD | 0/8 | 0.0% |
| < $50 USD | 0/8 | 0.0% |
| < $100 USD | 0/8 | 0.0% |
| < 3% error | 1/8 | 12.5% |

### Performance

| Metric | Time |
|--------|------|
| Total Runtime | 16.2s |
| Preload | 16.1s |
| Calculation | 0.13s |
| Per-Wallet Avg | 2.0s |

---

## Detailed Results

### Top 8 Wallets (by abs error)

| Wallet | V29 Realized | Dome Realized | Abs Error | Pct Error | Status |
|--------|--------------|---------------|-----------|-----------|--------|
| 0x5668...5839 (Theo4) | +$55.2K | +$22.05M | +$22.00M | 99.75% | ❌ FAIL |
| 0x1f2d...d0cf (Fredi9999) | +$265.9K | +$16.62M | +$16.35M | 98.40% | ❌ FAIL |
| 0xd235...0f29 (zxgngl) | +$92 | +$11.45M | +$11.45M | 100.00% | ❌ FAIL |
| 0x78b9...6b76 (Len) | +$0 | +$8.71M | +$8.71M | 100.00% | ❌ FAIL |
| 0x8631...aa53 (RepTrump) | +$12.7K | +$7.53M | +$7.52M | 99.83% | ❌ FAIL |
| 0x4ce7...abad (Smart Money) | +$19.85M | +$13.59M | +$6.27M | 46.12% | ❌ FAIL |
| 0xb48e...a144 (Smart Money) | +$109.6K | +$115.8K | +$6.1K | 5.30% | ❌ FAIL |
| 0x1f0a...f7aa (Smart Money) | +$118.1K | +$117.3K | +$753 | 0.64% | ✅ PASS |

---

## Key Findings

### 1. V29 Massively Underestimates Realized PnL

**Pattern:** Top 5 wallets show 98-100% error

**Example - Theo4 (0x5668):**
- Dome: $22.05M realized
- V29: $55.2K realized
- **Missing: $22M (99.75% error)**

**Example - Fredi9999 (0x1f2d):**
- Dome: $16.62M realized
- V29: $265.9K realized
- **Missing: $16.35M (98.4% error)**

### 2. One Wallet Has V29 > Dome

**Anomaly - 0x4ce7:**
- V29: $19.85M
- Dome: $13.59M
- V29 is $6.27M **higher** than Dome

**Possible causes:**
- Dome may not count certain transaction types
- V29 may be double-counting
- Data pipeline discrepancy

### 3. Small Wallets Show Good Accuracy

**Bottom 2 wallets:**
- 0x1f0a: 0.64% error (✅ excellent)
- 0xb48e: 5.30% error (acceptable)

**Pattern:** V29 works well for wallets with < $200K realized

---

## Hypotheses for Large Errors

### Hypothesis 1: Missing Trade Data

**Symptoms:**
- V29 shows near-zero PnL for wallets with millions in Dome
- Pattern consistent across high-volume wallets

**Possible Causes:**
- ERC1155 events not fully indexed
- CLOB fills incomplete in pm_trader_events
- Missing redemption events

### Hypothesis 2: Inventory Guard Too Aggressive

**Symptoms:**
- One wallet (0x4ce7) has V29 > Dome
- Suggests some trades are counted

**Possible Cause:**
- Inventory guard may be filtering out valid trades
- Negative inventory protection too strict

### Hypothesis 3: Resolution Price Issues

**Symptoms:**
- Zero realized PnL for some wallets (e.g., 0x78b9)

**Possible Cause:**
- Missing resolution prices in vw_pm_resolution_prices
- Markets resolved but prices not captured

### Hypothesis 4: Dome Uses Different Definition

**Symptoms:**
- Systematic underestimation across board

**Possible Cause:**
- Dome may include unredeemed resolved positions in "realized"
- V29 only counts fully closed positions

---

## Recommended Next Steps

### Immediate (Priority 1)

1. **Investigate Theo4 Wallet** (0x5668...5839)
   ```bash
   # Check event count
   SELECT count(*) FROM pm_unified_ledger_v8_tbl
   WHERE lower(wallet_address) = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
   ```

   **Expected:** Hundreds of thousands of events for $22M realized
   **If low:** Data pipeline issue
   **If high:** V29 calculation issue

2. **Check Dome API Definition**
   - Does Dome count unredeemed resolved positions?
   - Does Dome include splits/merges in realized?
   - Request Dome docs on "realized PnL" definition

3. **Compare to V17 Realized**
   - Run same wallets through V17 engine
   - If V17 matches Dome → V29 regression
   - If V17 matches V29 → Both engines have same issue

### Short Term (Priority 2)

1. **Forensic Event Analysis**
   - For Theo4: enumerate all events chronologically
   - Calculate manual PnL step-by-step
   - Identify where V29 diverges from expected

2. **Resolution Price Coverage Check**
   ```sql
   SELECT
     COUNT(DISTINCT condition_id) as total_conditions,
     COUNT(DISTINCT CASE WHEN resolved_price IS NOT NULL THEN condition_id END) as resolved
   FROM vw_pm_resolution_prices
   WHERE condition_id IN (
     SELECT DISTINCT condition_id FROM pm_unified_ledger_v8_tbl
     WHERE wallet_address = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
   )
   ```

3. **Inventory Guard Audit**
   - Check V29 code for negative inventory filtering
   - Verify filters aren't too aggressive
   - Test with inventory guard disabled

### Long Term

1. **Build Realized PnL Regression Suite**
   - Use Dome API as ground truth
   - Test 100+ wallets
   - Automated daily validation

2. **Investigate Unredeemed Resolved Positions**
   - Check if V29 should include these in realized
   - Compare to Polymarket UI definition

3. **Document Realized PnL Definition**
   - What counts as "realized"?
   - When is PnL locked in?
   - Edge cases (splits, merges, transfers)

---

## Infrastructure Delivered

### Core Files

1. **`lib/pnl/domeTruthLoader.ts`** - Dome API truth loader
   - Loads from snapshot or fetches live
   - Handles concurrency limits
   - Confidence levels

2. **`scripts/pnl/fetch-dome-realized-pnl.ts`** - Snapshot fetcher
   - Fetches realized PnL from Dome API
   - Rate-limited (concurrency control)
   - Outputs JSON snapshot

3. **`scripts/pnl/validate-v29-vs-dome-realized.ts`** - Validator
   - Compares V29 vs Dome realized PnL
   - Uses batch preload for speed
   - Detailed error reporting

### Output Files

- `tmp/dome_realized_snapshot_test.json` - Dome truth data (8 wallets)
- `tmp/v29_vs_dome_test.json` - Validation results
- `tmp/known_wallets_dome_test.json` - Test wallet list

---

## Usage

### Quick Validation (3 Commands)

```bash
# 1. Fetch Dome snapshot
npx tsx scripts/pnl/fetch-dome-realized-pnl.ts \
  --wallets-file=tmp/known_wallets_dome_test.json \
  --limit=8 \
  --concurrency=3 \
  --output=tmp/dome_snapshot.json

# 2. Run V29 validation
npx tsx scripts/pnl/validate-v29-vs-dome-realized.ts \
  --wallets-file=tmp/known_wallets_dome_test.json \
  --limit=8 \
  --snapshot=tmp/dome_snapshot.json \
  --output=tmp/v29_vs_dome_results.json

# 3. Analyze results
cat tmp/v29_vs_dome_results.json | jq '.rows | sort_by(.abs_error_usd) | reverse | .[0:5]'
```

### Expected Runtime

- Snapshot fetch (8 wallets): ~5 seconds
- V29 validation (8 wallets): ~16 seconds
- **Total:** ~21 seconds

---

## Dome API Details

### Endpoint

```
GET https://api.domeapi.io/v1/polymarket/wallet/pnl/{wallet_address}?granularity=all
```

### Authentication

```bash
Authorization: Bearer 3850d9ac-1c76-4f94-b987-85c2b2d14c89
```

### Response Format

```json
{
  "wallet_addr": "0x...",
  "granularity": "all",
  "start_time": 1728918952,
  "end_time": 1765069501,
  "pnl_over_time": [
    {
      "timestamp": 1765069501,
      "pnl_to_date": 22053933.7516
    }
  ]
}
```

### Key Fields

- `pnl_to_date`: Total realized PnL (this is our ground truth)
- **Definition:** "Tracks realized gains only - from either confirmed sells or redeems"

---

## Limitations

### 1. Small Sample Size

- Only 8 wallets tested
- Need 50-100 wallets for statistical significance

### 2. Dome API Rate Limits

- Free tier: Limited requests
- Need concurrency control to avoid rate limiting
- Consider dev tier for larger runs

### 3. Definition Ambiguity

- "Realized PnL" may have different definitions
- Dome vs Polymarket UI vs V29 may count different things
- Need clarification from Dome team

---

## Conclusion

The Dome API provides a **reliable, fast ground truth for realized PnL validation**. However, current V29 results show **critical accuracy issues**:

**✅ What Works:**
- Dome API integration (~5s for 8 wallets)
- Batch preload infrastructure
- Small wallets (< $200K): Good accuracy

**❌ What Doesn't Work:**
- Large wallets (> $1M): 98-100% error
- V29 missing $8-22M per wallet
- Only 12.5% pass rate

**🎯 Next Session:**
1. Investigate Theo4 wallet forensically
2. Compare V29 vs V17 vs Dome for same wallets
3. Check Dome API definition of "realized PnL"
4. Audit inventory guard for over-filtering

**Mission Status:** ⚠️  **COMPLETED WITH CRITICAL FINDINGS**

---

**Terminal 2 Signed: 2025-12-06 (Evening)**
**Next Terminal:** Forensic investigation of V29 realized PnL calculation
