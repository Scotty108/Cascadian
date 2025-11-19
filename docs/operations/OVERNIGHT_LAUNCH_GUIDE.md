# Overnight Worker Launch Guide

## Quick Start (2 minutes to launch)

### Option 1: Launch CLOB Worker Only (Safe, Fast Start)
```bash
npx tsx worker-clob-api.ts
```
**What it does:**
- Fetches markets from Polymarket CLOB API
- Creates `clob_market_mapping` table with market_id → condition_id pairs
- Tests enrichment potential
- Duration: ~1-2 hours
- Expected coverage improvement: 20-30%

### Option 2: Launch Full Orchestrator (Advanced)
```bash
npx tsx worker-orchestrator.ts
```
**What it does:**
- Runs CLOB worker + future RPC workers in parallel
- Coordinates all data pulling
- Currently implements CLOB (others can be enabled)
- Duration: ~5-6 hours total
- Expected coverage improvement: 30-40%+

## Real-Time Monitoring

### Check CLOB Progress
```bash
# While worker is running, check intermediate results
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client'
(async () => {
  const result = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT market_id) as markets FROM clob_market_mapping'
  })
  const count = JSON.parse(await result.text()).data[0].markets
  console.log('CLOB markets fetched: ' + count.toLocaleString())
})()
"
```

### Check Enrichment Test Results
```bash
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client'
(async () => {
  const result = await clickhouse.query({
    query: \`
SELECT
  COUNT(DISTINCT market_id) as total_missing,
  COUNT(CASE WHEN c.condition_id IS NOT NULL THEN 1 END) as can_enrich
FROM (SELECT DISTINCT market_id FROM trades_raw WHERE condition_id = '' LIMIT 100000) t
LEFT JOIN clob_market_mapping c ON t.market_id = c.market_id
    \`
  })
  const data = JSON.parse(await result.text()).data[0]
  console.log('Can enrich: ' + data.can_enrich + ' / ' + data.total_missing)
})()
"
```

## Next Steps After Worker Completes

### Apply CLOB Enrichment (if 40%+ coverage achievable)
```bash
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client'
(async () => {
  console.log('Applying CLOB mappings to all 160.9M trades...')
  await clickhouse.query({
    query: \`
UPDATE trades_raw t SET condition_id = c.condition_id
FROM clob_market_mapping c
WHERE t.market_id = c.market_id AND (t.condition_id = '' OR t.condition_id IS NULL)
    \`
  })
  console.log('✓ Done!')
})()
"
```

**OR** Use COALESCE if UPDATE not preferred:
```bash
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client'
(async () => {
  // Create enriched table using COALESCE pattern
  await clickhouse.query({
    query: \`
INSERT INTO trades_raw_enriched_final
SELECT
  t.*,
  COALESCE(t.condition_id, c.condition_id) as condition_id
FROM trades_raw t
LEFT JOIN clob_market_mapping c ON t.market_id = c.market_id
    \`
  })
})()
"
```

## Performance Expectations

### CLOB Worker
- **Fetching**: 1-2 hours (depends on API rate limits)
- **Expected results**: 50-100K markets
- **Coverage improvement**: 20-30% (from 51.47% → 70-80%)

### Full Orchestrator (when RPC workers added)
- **Total time**: 4-6 hours
- **Expected results**: 150K+ markets
- **Coverage improvement**: 40%+ (from 51.47% → 90%+)

## Troubleshooting

### CLOB API Rate Limiting
- **Symptom**: "Rate limited, waiting 5s"
- **Solution**: Worker automatically retries - this is normal!

### Large Result Set Issues
- **Symptom**: Timeout on enrichment step
- **Solution**: Use smaller batch sizes (already configured as 1000)

### No Results?
- **Check**: Is CLOB_API_KEY set in .env.local?
  ```bash
  grep CLOB_API_KEY .env.local
  ```

## Files Reference

| File | Purpose |
|------|---------|
| `OVERNIGHT_WORKER_STRATEGY.md` | Complete strategy & architecture |
| `OVERNIGHT_LAUNCH_GUIDE.md` | This file - quick start guide |
| `worker-clob-api.ts` | CLOB data fetcher |
| `worker-orchestrator.ts` | Master coordinator |

## Success Criteria

✅ **Success**:
- At least 70% condition_id coverage (vs 51.47% baseline)
- All workers complete without errors
- No data loss or corruption

⚠️ **Acceptable**:
- 60-70% coverage with CLOB alone
- Plan to add RPC workers next phase

❌ **Needs Review**:
- <60% coverage - may need additional data sources

## Questions?

Check:
1. `OVERNIGHT_WORKER_STRATEGY.md` for detailed architecture
2. Worker output logs for specific error messages
3. CLOB API authentication in `.env.local`

---

**Ready to launch?** Run:
```bash
npx tsx worker-clob-api.ts
```

Good luck! 🚀
