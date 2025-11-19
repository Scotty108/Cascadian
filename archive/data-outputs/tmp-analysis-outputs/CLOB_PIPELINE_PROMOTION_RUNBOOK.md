# CLOB Pipeline Promotion Runbook

**Purpose**: Promote staging tables to production after CLOB API access granted
**Status**: ⏸️ ON HOLD - Waiting for Polymarket API key
**Created**: 2025-11-11

---

## Prerequisites

### Required Before Promotion

- [ ] Polymarket CLOB API key obtained
- [ ] API key added to `.env.local` as `POLYMARKET_CLOB_API_KEY`
- [ ] ERC-1155 backfill complete (by Claude 3)
- [ ] Validation: 3+ wallets with CLOB fills successfully ingested
- [ ] Validation: Row counts match expected (see Session Report)

### Current State

**Staging Tables**:
- `pm_user_proxy_wallets_v2` - 6 rows (direct traders only)
- `clob_fills_v2` - 0 rows (blocked by 401 auth)

**Production Tables**:
- `pm_user_proxy_wallets` - Does not exist yet
- `clob_fills` - Does not exist yet

---

## Step 1: Add API Authentication

### Update CLOB Script

Edit `scripts/clob-pipeline-setup.ts` line 209:

**Before**:
```typescript
const url = `${CLOB_API_BASE}/trades?maker=${proxy.proxy_wallet}&limit=100`;
const response = await fetch(url, {
  headers: { 'Accept': 'application/json' },
});
```

**After**:
```typescript
const url = `${CLOB_API_BASE}/trades?maker=${proxy.proxy_wallet}&limit=100`;
const response = await fetch(url, {
  headers: {
    'Accept': 'application/json',
    'Authorization': `Bearer ${process.env.POLYMARKET_CLOB_API_KEY}`,
  },
});
```

### Add Environment Variable

Add to `.env.local`:
```
POLYMARKET_CLOB_API_KEY=your_api_key_here
```

---

## Step 2: Re-run Pipeline with Auth

```bash
# Dry run first
npx tsx scripts/clob-pipeline-setup.ts

# Expected output:
# ✅ Step 1: Staging tables ready (already exist)
# ✅ Step 2: 6 proxy mappings (already exist)
# ✅ Step 3: X fills ingested (should succeed now)
# ✅ Step 4: Validation showing CLOB fills for 3 wallets
```

### Validation Criteria

Before proceeding, verify:
- [ ] At least 3/6 wallets have CLOB fills > 0
- [ ] No 401 errors in Step 3
- [ ] `clob_fills_v2` row count > 0
- [ ] Date range looks reasonable (not 1970-01-01)

---

## Step 3: Discover Proxy-Separated Wallets

Current 6 benchmark wallets are all **direct traders**. Find wallets with separate proxies:

```typescript
// Add to scripts/find-proxy-wallets.ts
import { clickhouse } from '../lib/clickhouse/client';
import { resolveProxyViaAPI } from '../lib/polymarket/resolver';

// Get top 100 active wallets from your database
const wallets = await clickhouse.query({
  query: `
    SELECT DISTINCT wallet
    FROM wallet_metrics
    WHERE total_volume_usd > 10000
    ORDER BY total_volume_usd DESC
    LIMIT 100
  `,
  format: 'JSONEachRow',
});

// Resolve proxies for each
for (const { wallet } of await wallets.json()) {
  const proxy = await resolveProxyViaAPI(wallet);
  if (proxy && proxy.proxy_wallet !== proxy.user_eoa) {
    console.log(`Found proxy wallet: ${wallet} -> ${proxy.proxy_wallet}`);
    // Insert into pm_user_proxy_wallets_v2
  }
}
```

**Goal**: Find 10-20 wallets where `proxyWallet !== user_eoa` for better test coverage.

---

## Step 4: Backfill Historical CLOB Fills

Once authenticated, run full historical ingestion:

```bash
# Modify clob-pipeline-setup.ts to increase limit
# Change line 209: &limit=100 → &limit=1000

# Run backfill for all discovered proxy wallets
npx tsx scripts/clob-pipeline-setup.ts

# Monitor progress
watch -n 5 'echo "SELECT COUNT(*) FROM clob_fills_v2" | clickhouse-client --format=Pretty'
```

### Expected Timeline

- 6 direct traders with ~100 fills each: ~600 fills (5 minutes)
- 20 proxy wallets with ~1000 fills each: ~20,000 fills (30-60 minutes)

---

## Step 5: Validate Data Quality

### Check for Duplicates

```sql
-- Should return 0 rows
SELECT fill_id, COUNT(*) as cnt
FROM clob_fills_v2
GROUP BY fill_id
HAVING cnt > 1;
```

### Check for Missing Fields

```sql
-- Should return 0 rows
SELECT COUNT(*)
FROM clob_fills_v2
WHERE condition_id = '' OR proxy_wallet = '' OR user_eoa = '';
```

### Check Date Range

```sql
-- Should show reasonable date range (not 1970)
SELECT
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest,
  COUNT(*) as total_fills
FROM clob_fills_v2;
```

---

## Step 6: Promote Staging → Production

### Create Promotion Script

Create `scripts/promote-clob-tables.ts`:

```typescript
import { clickhouse } from '../lib/clickhouse/client';

async function promoteTables() {
  console.log('Promoting CLOB staging tables to production...\n');

  // Rename staging → production
  await clickhouse.exec({
    query: 'RENAME TABLE pm_user_proxy_wallets_v2 TO pm_user_proxy_wallets'
  });
  console.log('✅ Promoted pm_user_proxy_wallets_v2');

  await clickhouse.exec({
    query: 'RENAME TABLE clob_fills_v2 TO clob_fills'
  });
  console.log('✅ Promoted clob_fills_v2');

  // Verify
  const proxyCount = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_user_proxy_wallets',
    format: 'JSONEachRow',
  });
  const fillCount = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM clob_fills',
    format: 'JSONEachRow',
  });

  console.log(`\nProduction Tables:`);
  console.log(`  pm_user_proxy_wallets: ${(await proxyCount.json())[0].count} rows`);
  console.log(`  clob_fills: ${(await fillCount.json())[0].count} rows`);
}

promoteTables().catch(console.error);
```

### Run Promotion

```bash
npx tsx scripts/promote-clob-tables.ts
```

---

## Step 7: Update Application Code

### Update Queries to Use Production Tables

Search codebase for references to staging tables:

```bash
grep -r "clob_fills_v2" --include="*.ts" --include="*.tsx"
grep -r "pm_user_proxy_wallets_v2" --include="*.ts" --include="*.tsx"
```

Replace all occurrences with production table names.

### Test API Endpoints

```bash
# Test wallet proxy resolution
curl "http://localhost:3000/api/wallet/0xcce2b7c71f21e358b8e5e797e586cbc03160d58b/proxy"

# Test CLOB fills query
curl "http://localhost:3000/api/wallet/0xcce2b7c71f21e358b8e5e797e586cbc03160d58b/clob-fills"
```

---

## Step 8: Set Up Continuous Ingestion

### Create Cron Job for Daily Updates

Add to `scripts/daily-clob-sync.ts`:

```typescript
// Fetch new CLOB fills for all proxy wallets since last sync
const lastSync = await getLastSyncTimestamp();

for (const proxy of allProxies) {
  const fills = await fetchCLOBFills(proxy, { since: lastSync });
  await insertCLOBFills(fills);
}

updateLastSyncTimestamp(Date.now());
```

### Schedule Cron

```bash
# Add to crontab
0 */6 * * * cd /path/to/Cascadian-app && npx tsx scripts/daily-clob-sync.ts
```

**Frequency**: Every 6 hours (or adjust based on data freshness needs)

---

## Rollback Procedure

If promotion fails or issues discovered:

```sql
-- Rollback (if you kept old tables)
DROP TABLE pm_user_proxy_wallets;
DROP TABLE clob_fills;

RENAME TABLE pm_user_proxy_wallets_old TO pm_user_proxy_wallets;
RENAME TABLE clob_fills_old TO clob_fills;
```

**Note**: Only works if you created `_old` backup tables before promotion.

---

## Monitoring & Alerts

### Daily Health Checks

```sql
-- Check for stale data (no updates in 24 hours)
SELECT MAX(ingested_at) as last_update
FROM clob_fills
WHERE last_update < now() - INTERVAL 1 DAY;

-- Check for proxy mapping growth
SELECT COUNT(*) as total_proxies,
       COUNT(DISTINCT user_eoa) as unique_users
FROM pm_user_proxy_wallets;
```

### Alert Thresholds

- ❌ CLOB fills not updated in >24 hours
- ❌ Proxy mapping count decreased (data loss)
- ⚠️ New fills/day dropped by >50% (API issues)

---

## Decision Points

### ❓ Should We Promote Without CLOB API?

**Option A: Wait for API key**
- Pros: Complete CLOB order book data
- Cons: Indefinite delay, may never get access

**Option B: Promote with ERC-1155 only**
- Pros: Ship now, on-chain data is sufficient for P&L
- Cons: Missing off-chain order metadata

**Recommendation**: **Option B** if API key not available within 2 weeks.

### ❓ Should We Backfill Historical CLOB?

If API access granted, how far back to fetch:

- **Last 30 days**: Sufficient for active traders
- **Last 90 days**: Better historical context
- **All-time**: Complete but rate-limit intensive

**Recommendation**: Start with 90 days, expand if needed.

---

## Success Criteria

Before marking promotion complete:

- [ ] CLOB fills ingested for 10+ wallets
- [ ] No 401 auth errors
- [ ] Proxy mappings include 5+ proxy-separated wallets
- [ ] Data quality checks passed (no duplicates, no nulls)
- [ ] Application queries updated to use production tables
- [ ] Daily sync cron job scheduled and tested

---

## References

- Session Report: `reports/sessions/2025-11-11-session-3-clob-setup.md`
- Pipeline Script: `scripts/clob-pipeline-setup.ts`
- Proxy Resolver: `lib/polymarket/resolver.ts`
- API Testing: `scripts/test-proxy-api.ts`

---

**Last Updated**: 2025-11-11
**Status**: ⏸️ Awaiting Polymarket API key
**Next Review**: After API key obtained or 2 weeks (whichever comes first)
