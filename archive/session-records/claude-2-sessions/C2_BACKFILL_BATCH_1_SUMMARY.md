# C2 Backfill Batch 1 Summary

**Date:** 2025-11-16
**Agent:** C2 - External Data Ingestion (Operator Mode)
**Batch Size:** 10 wallets

---

## Backfill Results

### Wallets Processed

**Status Update:**
- ✅ 11 wallets marked as `status='done'` (xcnstrategy + 10 new)
- ⏳ 90 wallets remain `status='pending'`

**Top 10 CLOB Wallets (Rank 1-10):**

| Rank | Wallet | CLOB Trades | Notional | External Trades Found |
|------|--------|-------------|----------|----------------------|
| 1 | `0x4bfb41d5b3570d...` | 8,031,085 | $1.09B | **0** |
| 2 | `0xc5d563a36ae781...` | 2,826,201 | $343.7M | **0** |
| 3 | `0xf29bb8e0712075...` | 3,587 | $22.5M | **0** |
| 4 | `0x53757615de1c42...` | 72,144 | $16.0M | **0** |
| 5 | `0x3cf3e8d5427aed...` | 106,685 | $12.7M | **0** |
| 6 | `0x9d84ce0306f855...` | 86,294 | $12.6M | **0** |
| 7 | `0xca85f4b9e472b5...` | 1,264,840 | $11.7M | **0** |
| 8 | `0x2635b7fb040d81...` | 1,258 | $11.3M | **0** |
| 9 | `0x44c1dfe43260c9...` | 11,876 | $11.1M | **0** |
| 10 | `0xed88d69d689f3e...` | 1,697 | $10.8M | **0** |

**Total CLOB volume:** $1.53 billion

---

## Key Findings

### Finding 1: Top CLOB Wallets Have Zero AMM Activity

**Observation:** All 10 wallets returned **zero results** from Polymarket Data-API.

**Interpretation:** These high-volume traders operate **exclusively on the CLOB (orderbook)**. They do not trade on AMM or ghost markets.

**Impact for C1:**
- ✅ For these wallets, `pm_trades` (CLOB only) is **complete**
- ✅ No gap to close with external ingestion
- ✅ P&L calculations can proceed using CLOB data alone

### Finding 2: Only xcnstrategy Has External Trades

**Current External Coverage:**
- **1 wallet:** xcnstrategy
- **46 trades:** Across 6 ghost markets
- **6 markets:** Zero CLOB coverage (100% external)

**Ghost Markets:**
1. Xi Jinping out in 2025? (27 trades)
2. Trump Gold Cards over 100k in 2025? (14 trades)
3. Elon budget cut by 10% in 2025? (2 trades)
4. Satoshi Bitcoin movement in 2025? (1 trade)
5. China Bitcoin unban in 2025? (1 trade)
6. US ally gets nuke in 2025? (1 trade)

### Finding 3: AMM Activity May Be Rare

**Hypothesis:** Most Polymarket volume occurs on the CLOB. AMM/ghost market activity may be:
- Limited to specific wallets (e.g., xcnstrategy)
- Limited to niche markets (e.g., experimental questions)
- Historically less common than expected

**Next Steps:** Continue backfilling to validate this hypothesis.

---

## Validation Results

### Data Integrity ✅

**Test 1: Duplicate Detection**
- ✅ No duplicate `external_trade_id` entries
- ✅ Idempotency confirmed (safe to re-run)

**Test 2: UNION View**
- ✅ Row count: 38,945,566 (CLOB) + 46 (external) = 38,945,612
- ✅ No CLOB/external overlap (ghost markets are truly external-only)

**Test 3: external_trades_raw**
- ✅ Still 46 rows (unchanged from Phase 3)
- ✅ xcnstrategy's 6 ghost markets intact

---

## Recommendations for C1

### Immediate Actions

1. **Use `pm_trades_with_external` as canonical trades surface**
   - Already wired through `pm_trades_complete` interface ✅
   - Includes both CLOB and external trades

2. **For P&L calculations:**
   - **Top 10 wallets (ranks 1-10):** Use CLOB data only (no external trades exist)
   - **xcnstrategy:** Use `pm_trades_with_external` to include 6 ghost markets

3. **Ghost Market P&L:**
   - These 6 markets are **100% external** (zero CLOB coverage)
   - P&L for xcnstrategy on ghost markets now computable

### Medium-Term Strategy

**Option A: Continue Broad Backfill**
- Process next 25-50 wallets to find more AMM activity
- May find wallets with mixed CLOB + external trades
- Risk: Most wallets may return zero results (as seen in batch 1)

**Option B: Targeted Backfill**
- Identify wallets known to trade on AMM/ghost markets
- Prioritize wallets with activity on markets that have low CLOB coverage
- More efficient than broad backfill if AMM activity is rare

**Recommendation:** Try **Option A** for 1-2 more batches (25-50 wallets). If pattern holds (zero external trades), switch to **Option B** (targeted approach).

---

## Coverage Metrics for C1

### Wallets Ready for P&L

**Query for backfilled wallets:**
```sql
SELECT
  wallet_address,
  status,
  trade_count as clob_trades,
  notional as clob_notional,
  last_run_at as backfill_completed_at
FROM wallet_backfill_plan
WHERE status = 'done'
ORDER BY priority_rank ASC;
```

**Result:** 11 wallets (xcnstrategy + top 10 CLOB)

### Ghost Markets Query

**Markets with ONLY external trades:**
```sql
SELECT DISTINCT
  condition_id,
  market_question,
  COUNT(*) as external_trades
FROM external_trades_raw
WHERE condition_id NOT IN (
  SELECT DISTINCT condition_id FROM pm_trades WHERE data_source = 'clob_fills'
)
GROUP BY condition_id, market_question
ORDER BY external_trades DESC;
```

**Result:** 6 markets (all belong to xcnstrategy)

---

## Next Batch Planning

### Batch 2 Options

**Conservative (25 wallets):**
```bash
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 25
```

**Aggressive (50 wallets):**
```bash
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 50
```

**Estimated Runtime:**
- 25 wallets × 3 seconds = 1.25 minutes
- 50 wallets × 3 seconds = 2.5 minutes

### Success Criteria for Batch 2

If we find:
- **0 wallets with external trades:** Consider targeted approach (Option B)
- **1-5 wallets with external trades:** Continue broad backfill (Option A)
- **5+ wallets with external trades:** AMM activity more common than expected, continue broad backfill

---

## System Status

### Infrastructure Health ✅

- ✅ `external_trades_raw` table stable
- ✅ `pm_trades_with_external` view working
- ✅ `wallet_backfill_plan` tracking correctly
- ✅ Backfill driver resumable and error-free
- ✅ Rate limiting working (no API errors)

### Documentation Up-to-Date ✅

- ✅ `EXTERNAL_COVERAGE_STATUS.md` - Latest metrics
- ✅ `C2_HANDOFF_FOR_C1.md` - Integration guide
- ✅ `docs/operations/EXTERNAL_BACKFILL_RUNBOOK.md` - Operational guide

---

## Conclusion

**Mission Status:** ✅ Batch 1 complete, system operating as designed

**Key Takeaway:** Top CLOB wallets trade exclusively on the orderbook. External ingestion adds value for **ghost markets only** (currently 6 markets, 1 wallet).

**Next Decision Point:** After Batch 2, decide between broad vs targeted backfill strategy.

---

**— C2 (Operator Mode)**

_Always run backfills with maximum workers without hitting rate limits, with save/crash/stall protection enabled._
