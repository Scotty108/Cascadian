# Payout Vector Backfill - Quick Start (Goldsky API)

**Goal:** Backfill 170,448 missing payout vectors in 2-3 hours
**Source:** Goldsky GraphQL Subgraph API
**Impact:** Enable P&L calculation for resolved markets
**Timeline:** 2-3 hours with 4 workers

---

## TL;DR

```bash
# 1. Verify setup (30 seconds)
npx tsx verify-backfill-readiness.ts

# 2. Test API (1 minute)
npx tsx test-goldsky-payouts.ts

# 3. Run 4 workers in separate terminals (2-3 hours)
npx tsx backfill-payouts-parallel.ts --worker=1 --of=4
npx tsx backfill-payouts-parallel.ts --worker=2 --of=4
npx tsx backfill-payouts-parallel.ts --worker=3 --of=4
npx tsx backfill-payouts-parallel.ts --worker=4 --of=4

# 4. Monitor progress (optional, separate terminal)
npx tsx monitor-backfill-progress.ts

# 5. Validate results
npx tsx verify-backfill-completion.ts
```

---

## File Overview

| File | Purpose | When to Use |
|------|---------|-------------|
| `verify-backfill-readiness.ts` | Pre-flight checks | Before starting |
| `test-goldsky-payouts.ts` | Test API client | Before starting |
| `backfill-payouts-parallel.ts` | Main worker script | Run 4 instances |
| `monitor-backfill-progress.ts` | Real-time dashboard | During backfill |
| `verify-backfill-completion.ts` | Post-backfill validation | After completion |
| `BACKFILL_PAYOUTS_GUIDE.md` | Full documentation | Reference |

---

## Components Created

### 1. Goldsky Client (`lib/polymarket/goldsky-payouts.ts`)
- GraphQL API client
- Batch fetching (1,000 IDs per query)
- Retry logic with exponential backoff
- Rate limiting (2 req/sec)
- Payout parsing (handles both integer and decimal formats)

### 2. Parallel Worker System (`backfill-payouts-parallel.ts`)
- Multi-worker support (split 170k IDs across N workers)
- Checkpoint/resume capability
- Concurrent request processing (8 per worker)
- Batch ClickHouse inserts
- Progress logging to JSONL
- Graceful shutdown (Ctrl+C)

### 3. Monitoring & Validation
- Real-time progress dashboard
- Pre-flight readiness check
- Post-completion validation
- API client testing suite

---

## Expected Results

**Success Criteria:**
- 120,000-150,000 payouts inserted (not all markets are resolved)
- ~70-80% coverage of input IDs
- <1% error rate
- All payout sums valid (numerators sum to denominator)
- All winning indices valid (0-based, within bounds)

**Performance:**
- 4 workers: ~2-3 hours
- 8 workers: ~1-1.5 hours
- 2 workers: ~4-6 hours

---

## Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| Workers not starting | Check `.env.local` has ClickHouse credentials |
| GraphQL errors | Retry automatically (3x), reduce concurrency if persistent |
| Slow progress | Check `monitor-backfill-progress.ts` for stale workers |
| Worker stuck | Ctrl+C and restart - will resume from checkpoint |
| ClickHouse errors | Verify connection: `npx tsx verify-backfill-readiness.ts` |

---

## Integration After Backfill

Update `cascadian_clean.vw_resolutions_truth` to include Goldsky data:

```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
SELECT
  condition_id,
  payout_numerators,
  payout_denominator,
  winning_index,
  resolved_at,
  'market_resolutions_final' as source
FROM default.market_resolutions_final
WHERE payout_denominator > 0

UNION ALL

SELECT
  condition_id,
  payout_numerators,
  payout_denominator,
  winning_index,
  resolved_at,
  source
FROM default.resolutions_external_ingest
WHERE payout_denominator > 0
  AND arraySum(payout_numerators) > 0;
```

---

## Full Documentation

See `BACKFILL_PAYOUTS_GUIDE.md` for:
- Detailed architecture
- Performance tuning options
- Monitoring commands
- Validation queries
- Troubleshooting guide
- Integration steps

---

**Ready to start!** Run `verify-backfill-readiness.ts` first.
