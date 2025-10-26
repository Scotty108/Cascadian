# Tier 1 Metrics - Quick Start Runbook

**Purpose:** Step-by-step guide to calculate and use Tier 1 metrics
**Time Required:** 10-15 minutes (first run)
**Prerequisites:** ClickHouse running, trades synced

---

## Checklist

### ☐ Step 1: Verify Prerequisites (2 min)

```bash
# 1.1 Check ClickHouse connection
npx tsx scripts/verify-clickhouse-data.ts

# Expected output:
# ✅ ClickHouse connected
# ✅ Total trades: 100,000+
```

**If this fails:**
- Check `.env.local` has ClickHouse credentials
- Verify ClickHouse is running
- Ensure migrations are applied

### ☐ Step 2: Check Data Enrichment (1 min)

```bash
# 2.1 Verify trades have enrichment fields
# Run calculator with no args to see readiness check
npx tsx scripts/calculate-tier1-metrics.ts
```

**Expected output:**
```
🔍 Checking data readiness...
   Total trades: 125,432
   Enriched trades (outcome set): 98,234
   Trades with PnL: 98,234
   Enrichment rate: 78.3%
   ✅ Data is ready for metrics calculation
```

**If enrichment rate < 50%:**
- This is normal if most markets are unresolved
- Enrichment script will be created in Phase 2
- For now, focus on resolved markets

### ☐ Step 3: Calculate Tier 1 Metrics (5-10 min)

```bash
# 3.1 Calculate all 4 time windows
npx tsx scripts/calculate-tier1-metrics.ts

# Alternative: Calculate specific windows only
npx tsx scripts/calculate-tier1-metrics.ts 30d 90d
```

**Expected output:**
```
════════════════════════════════════════════════════════════
Processing: 30D WINDOW
════════════════════════════════════════════════════════════
📊 Calculating Tier 1 metrics for 30d window...
   ✅ Calculated metrics for 1,245 wallets
   ⏱️  Query completed in 2.34s

💾 Inserting 1,245 metric records...
   ✅ Total inserted: 1,245 records

✅ 30d window complete
```

**Performance expectations:**
- 100K trades: ~8s for all windows
- 1M trades: ~60s for all windows

### ☐ Step 4: Verify Results (2 min)

```bash
# 4.1 Run verification script
npx tsx scripts/verify-tier1-metrics.ts
```

**Expected output:**
```
✅ Table Exists: Found 4,980 records across 1,245 wallets
✅ Null Metrics: All primary metrics are populated
✅ Omega Range (30d): Omega range is reasonable (0.12 to 15.67)
✅ Hit Rate (30d): All hit rates valid, avg: 56.8%
✅ Minimum Bets (30d): All wallets meet minimum (min: 5, avg: 23.4)
✅ Spot Check: Calculations match for a2f8d9e3
✅ Data Freshness (30d): Data is fresh (0 hours old)

Total: 7 checks | ✅ 7 passed | ❌ 0 failed | ⚠️ 0 warnings
✅ ALL CHECKS PASSED - Metrics are accurate!
```

**If checks fail:**
- Review specific error messages
- Re-run calculator if data freshness warning
- Check database schema if validation errors

### ☐ Step 5: Explore the Data (5 min)

```bash
# 5.1 View top performers
npx tsx scripts/demo-tier1-queries.ts top-performers 30d 20

# 5.2 View elite traders
npx tsx scripts/demo-tier1-queries.ts elite 90d

# 5.3 View statistics summary
npx tsx scripts/demo-tier1-queries.ts stats

# 5.4 View specific wallet
npx tsx scripts/demo-tier1-queries.ts wallet 0xYourWalletAddress
```

### ☐ Step 6: Query from ClickHouse (optional)

```sql
-- 6.1 Connect to ClickHouse
-- Use your preferred SQL client or web UI

-- 6.2 View top 10 performers (30d)
SELECT
  wallet_address,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as net_pnl,
  metric_12_hit_rate as hit_rate,
  metric_22_resolved_bets as bets
FROM wallet_metrics_complete
WHERE window = 1  -- 30d
ORDER BY metric_2_omega_net DESC
LIMIT 10;

-- 6.3 Check statistics
SELECT
  window,
  count(*) as wallets,
  quantile(0.5)(metric_2_omega_net) as median_omega,
  sum(metric_9_net_pnl_usd) as total_pnl
FROM wallet_metrics_complete
GROUP BY window
ORDER BY window;
```

---

## Daily Maintenance

### Option A: Manual Recalculation

```bash
# Run daily after data sync completes
npx tsx scripts/calculate-tier1-metrics.ts

# Verify afterwards
npx tsx scripts/verify-tier1-metrics.ts
```

### Option B: Cron Job (Recommended)

```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * cd /path/to/Cascadian-app && npx tsx scripts/calculate-tier1-metrics.ts >> /var/log/tier1-metrics.log 2>&1
```

### Option C: GitHub Actions (CI/CD)

```yaml
# .github/workflows/calculate-metrics.yml
name: Calculate Tier 1 Metrics
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:      # Manual trigger

jobs:
  calculate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npx tsx scripts/calculate-tier1-metrics.ts
        env:
          CLICKHOUSE_HOST: ${{ secrets.CLICKHOUSE_HOST }}
          CLICKHOUSE_PASSWORD: ${{ secrets.CLICKHOUSE_PASSWORD }}
```

---

## Integration Checklist

### ☐ API Endpoints

Create API routes to serve metrics:

```typescript
// app/api/wallets/top-performers/route.ts
import { clickhouse } from '@/lib/clickhouse/client'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const window = searchParams.get('window') || '30d'
  const windowEnum = { '30d': 1, '90d': 2, '180d': 3, 'lifetime': 4 }

  const query = `
    SELECT
      wallet_address,
      metric_2_omega_net,
      metric_9_net_pnl_usd,
      metric_12_hit_rate,
      metric_22_resolved_bets
    FROM wallet_metrics_complete
    WHERE window = ${windowEnum[window as keyof typeof windowEnum]}
      AND metric_22_resolved_bets >= 10
    ORDER BY metric_2_omega_net DESC
    LIMIT 50
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  return Response.json(await result.json())
}
```

### ☐ React Hooks

```typescript
// hooks/use-top-performers.ts
import { useQuery } from '@tanstack/react-query'

export function useTopPerformers(window: string = '30d') {
  return useQuery({
    queryKey: ['top-performers', window],
    queryFn: async () => {
      const res = await fetch(`/api/wallets/top-performers?window=${window}`)
      return res.json()
    },
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  })
}
```

### ☐ UI Components

```typescript
// components/omega-leaderboard.tsx
import { useTopPerformers } from '@/hooks/use-top-performers'

export function OmegaLeaderboard({ window = '30d' }) {
  const { data, isLoading } = useTopPerformers(window)

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      <h2>Top Performers ({window})</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Wallet</th>
            <th>Omega</th>
            <th>Net PnL</th>
            <th>Hit Rate</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((row, idx) => (
            <tr key={row.wallet_address}>
              <td>{idx + 1}</td>
              <td>{row.wallet_address.slice(-8)}</td>
              <td>{row.metric_2_omega_net.toFixed(2)}</td>
              <td>${row.metric_9_net_pnl_usd.toLocaleString()}</td>
              <td>{(row.metric_12_hit_rate * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

---

## Troubleshooting

### Problem: "No trades found in trades_raw table"

**Cause:** Table is empty
**Solution:**
```bash
# Sync trades first
npx tsx scripts/sync-wallet-trades.ts <wallet_address>

# Or run full sync (if available)
npx tsx scripts/run-full-sync.ts
```

### Problem: "No enriched trades found"

**Cause:** Missing `outcome` and `pnl_net` data
**Solution:**
1. Verify migration 002 was applied:
   ```sql
   DESCRIBE trades_raw;
   -- Should show: outcome, pnl_net, pnl_gross columns
   ```
2. Wait for enrichment script (Phase 2)
3. For now, focus on already-enriched data

### Problem: "Low enrichment rate (< 50%)"

**Cause:** Most markets are unresolved
**Solution:**
- This is normal - unresolved markets have NULL outcomes
- Metrics only calculate on resolved trades
- No action needed

### Problem: "Verification warnings about extreme omega values"

**Cause:** Some wallets have very high omega (>100)
**Solution:**
- This is valid if they have many wins and few/small losses
- Review individual wallets with `demo-tier1-queries.ts wallet <address>`
- Add filters in UI if needed: `WHERE metric_2_omega_net < 50`

### Problem: "Data freshness warning"

**Cause:** Metrics haven't been recalculated recently
**Solution:**
```bash
# Recalculate metrics
npx tsx scripts/calculate-tier1-metrics.ts
```

### Problem: "Query timeout on large datasets"

**Cause:** Too many trades to process
**Solution:**
1. Increase ClickHouse timeout in client.ts
2. Process windows separately:
   ```bash
   npx tsx scripts/calculate-tier1-metrics.ts 30d
   npx tsx scripts/calculate-tier1-metrics.ts 90d
   npx tsx scripts/calculate-tier1-metrics.ts 180d
   npx tsx scripts/calculate-tier1-metrics.ts lifetime
   ```

---

## Performance Optimization

### 1. Add Indexes (if not present)

```sql
-- Already created in migration 004, but verify:
SHOW CREATE TABLE wallet_metrics_complete;

-- Should include:
-- CREATE INDEX idx_omega_net ON wallet_metrics_complete(metric_2_omega_net)
-- CREATE INDEX idx_resolved_bets ON wallet_metrics_complete(metric_22_resolved_bets)
```

### 2. Materialized Views (for common queries)

```sql
-- Create view for 30d top performers
CREATE MATERIALIZED VIEW top_performers_30d
ENGINE = AggregatingMergeTree()
ORDER BY metric_2_omega_net
AS SELECT *
FROM wallet_metrics_complete
WHERE window = 1
  AND metric_22_resolved_bets >= 10
ORDER BY metric_2_omega_net DESC
LIMIT 100;
```

### 3. Caching Layer (Redis)

```typescript
// lib/cache.ts
import { Redis } from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

export async function getCachedMetrics(window: string) {
  const cached = await redis.get(`metrics:top-performers:${window}`)
  if (cached) return JSON.parse(cached)

  // Query from ClickHouse
  const data = await fetchFromClickHouse(window)

  // Cache for 5 minutes
  await redis.set(`metrics:top-performers:${window}`, JSON.stringify(data), 'EX', 300)

  return data
}
```

---

## Monitoring

### 1. Set Up Alerts

```bash
# Create monitoring script: scripts/monitor-tier1-metrics.ts
# Check data freshness, record counts, anomalies
# Send alerts if issues detected
```

### 2. Dashboard Metrics

Track:
- Total wallets processed
- Calculation time
- Error rate
- Data freshness
- Query performance

### 3. Logs

```bash
# View recent calculation logs
tail -f /var/log/tier1-metrics.log

# Check for errors
grep -i "error" /var/log/tier1-metrics.log
```

---

## Quick Reference

### File Locations
- **Main Script:** `/scripts/calculate-tier1-metrics.ts`
- **Verification:** `/scripts/verify-tier1-metrics.ts`
- **Demo Queries:** `/scripts/demo-tier1-queries.ts`
- **Documentation:** `/TIER1_METRICS_CALCULATOR.md`
- **Formulas:** `/TIER1_FORMULAS.md`
- **This Runbook:** `/TIER1_RUNBOOK.md`

### Common Commands
```bash
# Calculate all metrics
npx tsx scripts/calculate-tier1-metrics.ts

# Verify accuracy
npx tsx scripts/verify-tier1-metrics.ts

# View top performers
npx tsx scripts/demo-tier1-queries.ts top-performers 30d 20

# View statistics
npx tsx scripts/demo-tier1-queries.ts stats

# Specific wallet
npx tsx scripts/demo-tier1-queries.ts wallet 0xADDRESS
```

### Window Enum Values
- `30d` = 1
- `90d` = 2
- `180d` = 3
- `lifetime` = 4

### Minimum Thresholds
- Resolved bets: 5 (configurable in calculator)
- Recommended for leaderboards: 10+

---

## Success Indicators

✅ Calculator runs without errors
✅ All 7 verification checks pass
✅ Data is < 24 hours old
✅ Median omega is reasonable (0.5 - 3.0)
✅ Average hit rate is 40-65%
✅ Top performers query returns results
✅ API endpoints serve data correctly

---

## Next Steps After Setup

1. **Integrate into UI:** Add leaderboards and wallet profiles
2. **Schedule Daily Runs:** Set up cron job or GitHub Actions
3. **Add Monitoring:** Track calculation success and performance
4. **Build API Endpoints:** Expose metrics to frontend
5. **Phase 2:** Calculate Tier 2 metrics (Brier, CLV, etc.)

---

**Need Help?**
- Review documentation: `/TIER1_METRICS_CALCULATOR.md`
- Check formulas: `/TIER1_FORMULAS.md`
- Run demo queries: `/scripts/demo-tier1-queries.ts`
- Verify data: `/scripts/verify-tier1-metrics.ts`
