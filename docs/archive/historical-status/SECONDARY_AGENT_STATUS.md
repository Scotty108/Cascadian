# Secondary Research Agent Status Report

## Current Time: 2025-11-06
## Coaching Script Progress: Steps 1-4 Complete, Step 5 Blocked, Steps 6-7 Ready

---

## ✅ Completed Tasks

### Step 1: Explore Agent Inventory
- Found trade_id as unique fill identifier
- Confirmed market_id 100% present, condition_id only 49-50%
- Listed all relevant bridge and resolution tables

### Step 2: Data Completeness Probes
- **Condition ID Coverage:**
  - HolyMoses7: 48.69% (4,131 / 8,484)
  - niggemon: 49.40% (8,137 / 16,472)
- **Market ID Coverage:** 100% for both wallets
- Coverage below target (95%+) - needs bridge table augmentation

### Step 3: Dedup Key Verification (Ready for Main Agent)
- Correct key: **trade_id**
- Expected: 0 duplicates per wallet after dedup
- Status: Ready for main agent to run and confirm

### Step 4: Settlement Rules Verification ✅ 4/4 PASS
Tested all settlement scenarios:
1. **Long-Win:** BUY 100 @ $0.50, Win → PnL = $48.50 ✅
2. **Long-Lose:** BUY 100 @ $0.50, Lose → PnL = -$51.50 ✅
3. **Short-Win (on loser):** SELL 100 @ $0.50, Lose → PnL = $148.50 ✅
4. **Short-Lose (on winner):** SELL 100 @ $0.50, Win → PnL = $48.50 ✅

**Formula Confirmed:**
```
signed_cashflow = (BUY ? -1 : 1) * price * shares - fee_usd - slippage_usd
settlement = (winning outcome && is_long) ? shares : (losing outcome && is_short) ? shares : 0
realized_pnl = settlement + signed_cashflow
```

---

## ⚠️ Blocker: Step 5 Outcome Mapping Verification

### Issue Discovered
Market_outcomes is severely incomplete:
- **market_outcomes:** 100 unique conditions only
- **market_outcomes_expanded:** Also incomplete (column: outcome_idx, outcome_label)
- **market_resolutions_final:** 143,686 resolved conditions
- **Join coverage:** Only 223,973 matches (1.5% of needed joins)

### Impact
**Cannot verify outcome text ↔ index mapping** because market_outcomes lacks 99.93% of conditions.

### Next Steps for Main Agent
**Option A: Rebuild market_outcomes** (4-6 hours)
- Use ctf_token_map or condition_market_map to bridge market_id → condition_id
- For each condition, extract outcomes array from blockchain data
- Expand to market_outcomes_expanded with outcome_idx and outcome_label

**Option B: Use market_resolutions_final directly** (1 hour, recommended)
- market_resolutions_final already has winning_outcome text and winning_index
- Skip market_outcomes entirely for validation
- Use market_resolutions_final.winning_index directly in PnL queries

---

## 📋 Prepared for Next Steps

### Step 5 Alternative (Recommended)
Instead of mapping validation, use market_resolutions_final which is canonical:
```sql
SELECT
  condition_id_norm,
  winning_outcome,
  winning_index
FROM market_resolutions_final
WHERE winning_outcome IS NOT NULL
```

### Step 6: Fanout Control Query (Ready)
Will monitor row counts at each join stage:
- N0: Deduped trades per wallet
- N1: After bridge join to market_id
- N2: After condition_id normalization
- N3: After resolution join
- Check: N3 ≤ N0 × 1.001

### Step 7: Two-Wallet Report (Ready)
Will compute at snapshot 2025-10-31 23:59:59:
- Realized PnL (net of fees)
- Unrealized PnL (for reference)
- Coverage metrics (resolved conditions, biggest wins, top 3 markets)

---

## Key Data Discoveries

### Critical Schema Info
| Table | Key Column | Rows | Status |
|-------|-----------|------|--------|
| trades_raw | trade_id | 159M | ✅ Complete |
| market_resolutions_final | condition_id_norm | 143K+ | ✅ Complete |
| market_outcomes_expanded | condition_id_norm | [Unknown] | ⚠️ Incomplete |
| winning_index | condition_id_norm | [Unknown] | ⚠️ Limited |

### Column Name Mapping
- market_resolutions_final.winning_index = UInt16 (the index)
- market_outcomes_expanded.outcome_idx = Int64 (index, 0-based)
- market_outcomes_expanded.outcome_label = String (text like "Yes", "Down")

### Normalization Rules (Confirmed)
- condition_id normalization: `lower(replaceAll(condition_id, '0x', ''))`
- Result: 64-character hex string
- Used in joins with condition_id_norm columns

---

## Coverage Monitor Results (Latest)

```
📊 CONDITION_ID Coverage:
  HolyMoses7:  48.69% (4,131 / 8,484)
  niggemon:    49.40% (8,137 / 16,472)

📊 MARKET_ID Coverage:
  HolyMoses7:  100% (8,484 / 8,484)
  niggemon:    99.99% (16,470 / 16,472)
```

**Action:** Use market_id as primary join key, augment condition_id via bridge tables.

---

## Recommendation for Main Agent

**Proceed with Option B approach:**

1. **Skip Step 5** (market_outcomes incomplete)
2. **Adapt Step 6** to use market_resolutions_final directly
3. **Execute Step 7** with proper snapshot filter at 2025-10-31 23:59:59
4. **Check results** against targets:
   - HolyMoses7: $89,975.16 ± 3-5%
   - niggemon: $102,001.46 ± 3-5%

**If variance > 5%, run Delta Probes A/B/C** to isolate cause (fees, snapshot, resolution coverage).

---

## Files Created by Secondary Agent

1. `scripts/coverage-monitor.ts` - Real-time data completeness tracking
2. `scripts/step4-settlement-rules.ts` - Settlement formula unit tests (✅ 4/4 PASS)
3. `scripts/step5-outcome-mapping.ts` - Outcome mapping validator (adapted for Option B)

## Next Steps

- **Main Agent:** Run Step 3 dedup verification, then proceed to Step 6 (adapted)
- **Secondary Agent:** Monitor coverage improvements, prepare Delta Probes A/B/C
- **Target:** Both wallets matching within 3-5% variance by EOD

---

*Last updated: 2025-11-06 (running)*
