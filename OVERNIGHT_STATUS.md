# Overnight Wallet Intelligence Job Status

## Current Status: STOPPED

**Started:** 2026-01-10 09:41 UTC
**Last Update:** 2026-01-10 16:49 UTC (Batch 14)
**Runtime:** ~7 hours 7 minutes
**Progress:** 1,395 wallets / 18,016 (7.8%)
**Rate:** ~3.3 wallets/minute
**Estimated completion:** ~84 hours at last observed rate

## Investigation Results (Jan 10, 2026)

### PnL Engine Accuracy Testing

Tested V1 and V38 engines against Polymarket API:

| Engine | Passing Wallets | Failing Wallets |
|--------|-----------------|-----------------|
| V1     | 4/4 (0-2% error) | 0/3 (17-121% error) |
| V38    | 4/4 (0-3% error) | 0/3 (17-163% error) |

### Key Finding: tx_hash Linkage

**Hypothesis tested:** CTF events under exchange/adapter addresses can be attributed to wallets via tx_hash.

**Result:** tx_hash linkage EXISTS but causes DOUBLE-COUNTING:
- Found 706 CTF events linked via tx_hash to failing wallet
- Adding these events made PASSING wallets WORSE (0%→12.5%, 0%→100% error)
- CTF events via tx_hash represent INTERNAL CLOB mechanics (already in trade price)

**Correct interpretation:**
- CTF events under `user_address = wallet` → DIRECT activity (V38 handles correctly)
- CTF events under exchange/adapter → INTERNAL mechanics (should NOT be added)

### Production Recommendation

1. **Primary:** Use Polymarket API (V7) for PnL - 100% accurate
2. **Fallback:** Use V1 for CLOB-simple wallets when API unavailable
3. **Confidence:** Mark wallets with bundled transactions as "low confidence"

## Data Collected So Far

| Metric | Value |
|--------|-------|
| Wallets processed | 1,395 (batch 14/181 complete) |
| Trades processed | ~1.7M |
| Timeout errors | 5 wallets (in first batch) |

## Files Created

- `lib/pnl/pnlEngineV41.ts` - tx_hash attribution engine (not recommended)
- `scripts/pnl-cohort-test-v1.ts` - V1 accuracy test
- `scripts/pnl-cohort-test-v38.ts` - V38 accuracy test
- `docs/READ_ME_FIRST_PNL.md` - Updated with tx_hash findings

## Next Steps

### Option A: Continue Batch Job (NOT RECOMMENDED)
- Job is collecting data with potentially inaccurate PnL
- Use API-based PnL instead

### Option B: Restart with API-Based PnL (RECOMMENDED)
1. Modify batch job to fetch PnL from Polymarket API
2. Use V1 as fallback only
3. Focus on non-PnL metrics (trade timing, volume, CLV)

### Option C: Focus on Non-PnL Metrics Only
- The 18K wallet list is still valuable for timing/volume analysis
- Skip PnL calculation entirely, use API when needed

## Process Info

```
PID: (stopped)
Last batch: 14/181
Last wallet count: 1395/18016
```

To restart: `npx tsx scripts/overnight-wallet-intelligence.ts`
To monitor: `tail -f overnight-progress.log`
