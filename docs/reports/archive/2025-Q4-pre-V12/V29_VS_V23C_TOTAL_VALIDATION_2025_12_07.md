# V29 vs V23C Total PnL Validation

**Date:** 2025-12-07
**Terminal:** Claude 2 (Results Terminal)
**Comparison:** V29 Total PnL vs V23C Total PnL
**Benchmark Set:** `trader_strict_v2_2025_12_07`
**Tolerance:** 6%

---

## Executive Summary

V29 total PnL validated against V23C total PnL on 42-wallet trader_strict_v2 cohort shows **poor accuracy** with only **29% pass rate**. Critical finding: **V29 unrealized is near-zero** for 93% of wallets, meaning V29 total ≈ V29 realized. This suggests **fundamental data or calculation differences** between V23C and V29, not unrealized tracking issues.

**Key Findings:**
- **Pass Rate (< 6% error):** 5/17 testable wallets (29%)
- **V29 Unrealized:** Only 3/42 wallets have >$100 unrealized
- **V29 Total ≈ V29 Realized:** 24/42 wallets show perfect match
- **Median Error:** $6,000 (57%)
- **P90 Error:** $98,366 (122%)

**Status:** 🚨 **CRITICAL DISCREPANCY** - V29 and V23C produce fundamentally different PnL values despite using same data source.

---

## Validation Results

### Summary Statistics

```
═══════════════════════════════════════════════════════════════════
V29 TOTAL vs V23C TOTAL (Correct Comparison)
Benchmark Set: trader_strict_v2_2025_12_07
Tolerance: 6%
═══════════════════════════════════════════════════════════════════

Testable Wallets (>$100): 17
Pass Rate (< 6%): 5/17 (29%)
Fail Rate (>= 6%): 12/17 (70%)

Median Abs Error: $6,000
Median % Error: 57%
P90 Abs Error: $98,366
P90 % Error: 122%

═══════════════════════════════════════════════════════════════════
```

### Unrealized PnL Analysis

```
Total Wallets: 42
With Unrealized (>$100): 3 (7%)
Without Unrealized (<$100): 39 (93%)
Perfect Match (total = realized): 24 (57%)
```

**Key Insight:** V29 unrealized is **essentially zero** for most wallets, so V29 total ≈ V29 realized. This means the discrepancy vs V23C is NOT due to unrealized tracking differences.

---

## Top 10 Worst Offenders

| Wallet | V23C Total | V29 Total | V29 Realized | V29 Unrealized | Abs Error | % Error |
|--------|-----------|----------|-------------|---------------|-----------|---------|
| 0xdf93...bdc8 | $101,777 | **-$23,129** | -$20,932 | -$2,197 | $124,905 | 122% |
| 0xdfda...4fe6 | $184,823 | $86,456 | $86,456 | $0 | $98,366 | 53% |
| 0x7a30...abd | $51,572 | $675 | $730 | -$56 | $50,897 | 98% |
| 0x688b...fe1 | $47,515 | $341 | $341 | $0 | $47,174 | 99% |
| 0x3df0...8f0 | $37,158 | **-$4,752** | -$4,752 | $0 | $41,909 | 112% |
| 0x4d6d...1ba1 | $16,016 | **-$9,576** | -$9,576 | $0 | $25,592 | 159% |
| 0xf118...1f58 | $20,204 | $8,663 | $9,588 | -$925 | $11,541 | 57% |
| 0x17b4...d48 | $13,156 | $4,915 | $4,929 | -$15 | $8,240 | 62% |
| 0x2c24...309c | $5,904 | **-$96** | -$96 | $0 | $6,000 | 101% |
| 0x2e41...050 | $29,962 | $27,048 | $27,048 | $0 | $2,914 | 9% |

---

## Critical Patterns

### Pattern 1: Sign Flip (V23C Positive, V29 Negative)

**4 wallets** show V23C reporting **positive** PnL while V29 reports **negative** PnL:

| Wallet | V23C | V29 Total | V29 Unrealized | Issue |
|--------|------|----------|---------------|-------|
| 0xdf93...bdc8 | +$101K | -$23K | -$2.2K | Sign flip |
| 0x3df0...8f0 | +$37K | -$4.7K | $0 | Sign flip |
| 0x4d6d...1ba1 | +$16K | -$9.5K | $0 | Sign flip |
| 0x2c24...309c | +$5.9K | -$96 | $0 | Sign flip |

**Analysis:**
- V29 unrealized is near-zero, so this is NOT an unrealized tracking issue
- V29 total = V29 realized for 3 of these wallets
- Suggests **fundamental calculation difference** or **data difference** between engines

**Hypothesis:**
1. V23C may include certain event types that V29 excludes (splits/merges/transfers?)
2. V29 inventory guard may be filtering out valid trades
3. Different cost basis calculation methods
4. Different resolution price sources

### Pattern 2: Massive Undercount (V29 < 2% of V23C)

**2 wallets** show V29 capturing less than 2% of V23C value:

| Wallet | V23C | V29 Total | Capture Rate | V29 Unrealized |
|--------|------|----------|-------------|---------------|
| 0x7a30...abd | $51,572 | $675 | 1.3% | -$56 |
| 0x688b...fe1 | $47,515 | $341 | 0.7% | $0 |

**Analysis:**
- Similar to pre-fix Dome validation (Theo4 showing 0.25% before redemption fix)
- But these wallets show V29 total ≈ V29 realized (unrealized is zero)
- Suggests V29 is **missing the majority of events** for these wallets

**Action:** Deep dive on one of these wallets to identify missing event types.

### Pattern 3: Moderate Undercount (V29 ≈ 50% of V23C)

**3 wallets** show V29 capturing approximately half of V23C value:

| Wallet | V23C | V29 Total | Capture Rate |
|--------|------|----------|-------------|
| 0xdfda...4fe6 | $184,823 | $86,456 | 46.8% |
| 0xf118...1f58 | $20,204 | $8,663 | 42.9% |
| 0x17b4...d48 | $13,156 | $4,915 | 37.4% |

**Analysis:**
- More consistent pattern than sign flips or massive undercounts
- May indicate specific event type systematically missing (50% suggests binary split)

---

## Comparison: V29 vs Dome vs V23C

### Dome Validation (Post-Fix)

**8 wallets, V29 Realized vs Dome Realized:**
- Pass Rate (< 3%): 6/8 (75%) ✅
- Median Error: $20.3K (1.19%)
- Top performer: 0x5668 (Theo4) = 0.16% error

### V23C Validation (Post-Fix)

**17 wallets, V29 Total vs V23C Total:**
- Pass Rate (< 6%): 5/17 (29%) ❌
- Median Error: $6,000 (57%)
- Worst performer: 0x4d6d = 159% error

**Conclusion:**
- V29 matches **Dome API** very well (75% pass rate)
- V29 does NOT match **V23C** well (29% pass rate)
- This suggests **V23C and Dome use different data sources or calculation methods**

---

## Root Cause Hypotheses

### Hypothesis 1: V23C Includes Event Types V29 Excludes ⭐⭐⭐⭐⭐

**Evidence:**
- V29 unrealized is near-zero, ruling out unrealized tracking differences
- 4 wallets show sign flips (V23C positive, V29 negative)
- 2 wallets show 98%+ undercounts

**Possible Event Types:**
- Splits/merges (CTF operations)
- Transfers (wallet-to-wallet)
- Faucet/airdrops
- Fee rebates

**Test:**
```sql
SELECT event_type, COUNT(*)
FROM pm_unified_ledger_v8_tbl
WHERE wallet_address = '0x7a3051610fed486c6f21e04a89bddaf22dfc8abd'
GROUP BY event_type;
```

### Hypothesis 2: Different Cost Basis Methods ⭐⭐⭐⭐

**Evidence:**
- V23C may use FIFO while V29 uses inventory tracking
- Could explain systematic differences

**Test:** Compare cost basis calculations on same event sequence.

### Hypothesis 3: Different Resolution Price Sources ⭐⭐⭐

**Evidence:**
- V23C uses `vw_pm_ui_prices` (UI oracle)
- V29 uses `vw_pm_resolution_prices` (blockchain resolution)
- Could cause small systematic differences

**Test:** Compare resolution prices for resolved conditions.

### Hypothesis 4: V29 Inventory Guard Over-Filtering ⭐⭐

**Evidence:**
- Guard proved innocent in Dome validation
- But may filter differently for these specific wallets

**Test:** Re-run with `inventoryGuard: false` for worst offenders.

---

## Recommended Actions

### P0: Deep Dive on 0x7a30...abd (1.3% Capture Rate)

**Goal:** Identify exactly which events V23C counts that V29 excludes.

**Steps:**
1. Query all events for this wallet from `pm_unified_ledger_v8_tbl`
2. Manually calculate expected PnL using V23C logic
3. Compare with V29 calculation step-by-step
4. Identify divergence point

### P1: Compare Event Type Coverage

For worst 10 wallets:
```sql
SELECT
  event_type,
  COUNT(*) as event_count,
  SUM(token_amount) / 1000000.0 as total_tokens
FROM pm_unified_ledger_v8_tbl
WHERE wallet_address IN ('0x7a30...', '0x688b...', ...)
GROUP BY event_type;
```

### P2: Test V29 with Guard OFF

Re-run worst 10 wallets with `inventoryGuard: false` to rule out over-filtering:
```bash
npx tsx scripts/pnl/debug-wallet-v29-realized.ts \
  --wallet=0x7a3051610fed486c6f21e04a89bddaf22dfc8abd \
  --inventory-guard=false
```

### P3: Investigate Sign Flip Wallets

For 4 wallets showing sign flips, check:
- Total USDC inflows vs outflows
- Event type distribution
- Whether V23C and V29 agree on event sequence

---

## Key Questions to Answer

1. **What event types does V23C include that V29 excludes?**
   - Splits/merges?
   - Transfers?
   - Other CTF operations?

2. **Do V23C and V29 use same cost basis method?**
   - FIFO vs inventory tracking
   - Average cost vs specific identification

3. **Do V23C and V29 use same resolution prices?**
   - UI oracle vs blockchain resolution
   - Could explain small systematic differences

4. **Why does V29 match Dome (75%) but not V23C (29%)?**
   - Dome and V29 both use "realized-only" definition
   - V23C may include unrealized or other components
   - OR V23C may use different data source

---

## Conclusion

**V29 total PnL validation against V23C shows poor results (29% pass rate), BUT this does NOT invalidate the V29 engine.**

**Key Evidence:**
1. V29 matches **Dome API** very well (75% pass rate)
2. V29 unrealized is **near-zero** for 93% of wallets
3. V23C shows **fundamentally different values** (sign flips, 98% undercounts)
4. This suggests **V23C and V29 use different data or calculation logic**

**Recommended Path Forward:**
1. **Deep dive on worst wallet** (0x7a30...abd) to identify missing events
2. **Compare event type coverage** between V23C and V29
3. **Document V23C vs V29 calculation differences**
4. **Decide which engine is "correct"** based on requirements

**Do NOT assume V23C is ground truth** - Dome validation suggests V29 may be more accurate for "realized-only" PnL definition.

---

**Terminal 2 Signed: 2025-12-07 (Late Evening)**
**Status:** V29 total vs V23C comparison complete - 29% pass rate but V23C may not be correct baseline
**Next Session:** Deep dive on worst wallet to identify V23C vs V29 calculation differences

---
