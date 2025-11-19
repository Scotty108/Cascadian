# Polymarket API Implementation Guide

## Quick Start (5 Minutes)

### Test the APIs Right Now

```bash
# 1. Test Data API integration
npx tsx test-data-api-integration.ts

# 2. Backfill single wallet
npx tsx backfill-wallet-pnl-from-api.ts 0x4ce73141dbfce41e65db3723e31059a730f0abad

# 3. Backfill top 100 wallets
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 100
```

### Verify Results

```sql
-- Check if data was inserted
SELECT count(*) FROM polymarket.wallet_positions_api;

-- Get wallet P&L summary
SELECT
  wallet_address,
  count() as positions,
  sum(cash_pnl) as total_pnl,
  sum(realized_pnl) as realized_pnl
FROM polymarket.wallet_positions_api
GROUP BY wallet_address
ORDER BY abs(total_pnl) DESC
LIMIT 20;

-- Compare API vs calculated P&L
SELECT
  api.wallet_address,
  api.total_cash_pnl as api_pnl,
  calc.total_pnl_usd as calculated_pnl,
  api.total_cash_pnl - calc.total_pnl_usd as difference,
  abs(api.total_cash_pnl - calc.total_pnl_usd) / greatest(abs(api.total_cash_pnl), 0.01) * 100 as percent_diff
FROM (
  SELECT wallet_address, sum(cash_pnl) as total_cash_pnl
  FROM polymarket.wallet_positions_api
  GROUP BY wallet_address
) api
LEFT JOIN polymarket.vw_wallet_pnl calc
  ON api.wallet_address = calc.wallet_address
ORDER BY abs(difference) DESC
LIMIT 20;
```

---

## Full Integration Plan

### Phase 1: Immediate Win (1-2 hours)

**Goal:** Get accurate P&L for test wallet

1. ✅ Run test script (already done)
2. ✅ Create ClickHouse table (script ready)
3. ⏭️ Backfill test wallet
4. ⏭️ Verify against Polymarket UI
5. ⏭️ Document discrepancies

**Commands:**
```bash
# Run all tests
npx tsx test-data-api-integration.ts

# Backfill test wallet
npx tsx backfill-wallet-pnl-from-api.ts 0x4ce73141dbfce41e65db3723e31059a730f0abad

# Check results
clickhouse-client --query "SELECT sum(cash_pnl) FROM polymarket.wallet_positions_api WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'"
```

**Expected Result:**
- Wallet P&L matches Polymarket UI (~$332K in losses)
- Can see individual position breakdown
- Understand where our calculations differ

### Phase 2: Top Wallets Backfill (2-4 hours)

**Goal:** Get P&L for all significant wallets

1. Query top 1000 wallets by volume/P&L
2. Backfill in batches (100 at a time)
3. Compare API vs calculated P&L
4. Identify systematic issues

**Commands:**
```bash
# Backfill top wallets in batches
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 100
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 500
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 1000
```

**Analysis Queries:**
```sql
-- Wallets with biggest discrepancies
SELECT
  wallet_address,
  api_pnl,
  calculated_pnl,
  difference,
  percent_diff
FROM (
  SELECT
    api.wallet_address,
    api.total_cash_pnl as api_pnl,
    calc.total_pnl_usd as calculated_pnl,
    api.total_cash_pnl - calc.total_pnl_usd as difference,
    abs(api.total_cash_pnl - calc.total_pnl_usd) / greatest(abs(api.total_cash_pnl), 0.01) * 100 as percent_diff
  FROM (
    SELECT wallet_address, sum(cash_pnl) as total_cash_pnl
    FROM polymarket.wallet_positions_api
    GROUP BY wallet_address
  ) api
  LEFT JOIN polymarket.vw_wallet_pnl calc
    ON api.wallet_address = calc.wallet_address
)
WHERE abs(percent_diff) > 10  -- More than 10% difference
ORDER BY abs(difference) DESC;

-- Missing condition IDs in our system
SELECT DISTINCT
  api.condition_id,
  api.market_title,
  count(*) as wallets_affected,
  sum(api.cash_pnl) as total_pnl_impact
FROM polymarket.wallet_positions_api api
LEFT JOIN polymarket.fact_trades_canonical ftc
  ON api.condition_id = ftc.condition_id
WHERE ftc.condition_id IS NULL
GROUP BY api.condition_id, api.market_title
ORDER BY abs(total_pnl_impact) DESC;
```

### Phase 3: Payout Vector Backfill (1-2 hours)

**Goal:** Fill gaps in resolution data

1. Query all resolved conditions from Goldsky subgraph
2. Insert into new table `polymarket.condition_payouts_subgraph`
3. Cross-reference with our existing resolution data
4. Identify missing resolutions

**Create the client:**
```typescript
// /lib/polymarket/subgraph-client.ts
import { createClient } from '@clickhouse/client';

const GOLDSKY_ENDPOINT =
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';

export interface Condition {
  id: string;
  payouts: string[];
}

export async function getResolvedConditions(
  first = 1000,
  skip = 0
): Promise<Condition[]> {
  const query = `{
    conditions(
      first: ${first}
      skip: ${skip}
      where: {payouts_not: null}
    ) {
      id
      payouts
    }
  }`;

  const response = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph error: ${response.status}`);
  }

  const result = await response.json();
  return result.data.conditions;
}

export async function getAllResolvedConditions(): Promise<Condition[]> {
  const allConditions: Condition[] = [];
  let skip = 0;
  const first = 1000;

  while (true) {
    const conditions = await getResolvedConditions(first, skip);
    if (conditions.length === 0) break;

    allConditions.push(...conditions);
    console.log(`Fetched ${conditions.length} conditions (total: ${allConditions.length})`);

    if (conditions.length < first) break;
    skip += first;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return allConditions;
}
```

**ClickHouse Table:**
```sql
CREATE TABLE IF NOT EXISTS polymarket.condition_payouts_subgraph (
  condition_id String,
  payout_numerators Array(Float64),
  payout_denominator Float64,
  winning_outcome_index UInt8,
  fetched_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY condition_id;
```

**Backfill Script:**
```typescript
// backfill-payout-vectors.ts
import { getAllResolvedConditions } from './lib/polymarket/subgraph-client';
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  database: 'polymarket',
});

async function main() {
  console.log('Fetching all resolved conditions from subgraph...');
  const conditions = await getAllResolvedConditions();
  console.log(`Found ${conditions.length} resolved conditions`);

  const rows = conditions.map(c => {
    const payouts = c.payouts.map(p => parseFloat(p));
    const maxPayout = Math.max(...payouts);
    const winningIndex = payouts.findIndex(p => p === maxPayout);

    return {
      condition_id: c.id.toLowerCase().replace('0x', ''),
      payout_numerators: payouts,
      payout_denominator: 1.0,
      winning_outcome_index: winningIndex,
    };
  });

  await clickhouse.insert({
    table: 'polymarket.condition_payouts_subgraph',
    values: rows,
    format: 'JSONEachRow',
  });

  console.log(`✅ Inserted ${rows.length} payout vectors`);
  await clickhouse.close();
}

main().catch(console.error);
```

### Phase 4: Create Unified P&L View (30 minutes)

**Goal:** Single source of truth for wallet P&L

```sql
CREATE OR REPLACE VIEW polymarket.vw_wallet_pnl_unified AS
SELECT
  wallet_address,
  -- Use API data as primary source
  api_total_pnl,
  api_realized_pnl,
  api_positions_count,
  -- Include our calculated values for comparison
  calculated_total_pnl,
  calculated_realized_pnl,
  calculated_positions_count,
  -- Metadata
  data_source,
  last_updated
FROM (
  -- API data (preferred)
  SELECT
    wallet_address,
    sum(cash_pnl) as api_total_pnl,
    sum(realized_pnl) as api_realized_pnl,
    count() as api_positions_count,
    0 as calculated_total_pnl,
    0 as calculated_realized_pnl,
    0 as calculated_positions_count,
    'polymarket_api' as data_source,
    max(fetched_at) as last_updated
  FROM polymarket.wallet_positions_api
  GROUP BY wallet_address

  UNION ALL

  -- Our calculated data (fallback)
  SELECT
    wallet_address,
    0 as api_total_pnl,
    0 as api_realized_pnl,
    0 as api_positions_count,
    total_pnl_usd as calculated_total_pnl,
    realized_pnl_usd as calculated_realized_pnl,
    position_count as calculated_positions_count,
    'calculated' as data_source,
    now() as last_updated
  FROM polymarket.vw_wallet_pnl
  WHERE wallet_address NOT IN (
    SELECT DISTINCT wallet_address
    FROM polymarket.wallet_positions_api
  )
)
ORDER BY abs(api_total_pnl + calculated_total_pnl) DESC;
```

### Phase 5: Automated Sync (1-2 hours)

**Goal:** Keep API data fresh

**Cron Job Options:**

1. **Daily full sync** (for top 1000 wallets):
```bash
# Add to crontab
0 2 * * * cd /path/to/project && npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 1000
```

2. **Hourly incremental** (for active wallets):
```sql
-- Get wallets with recent trades
SELECT DISTINCT wallet_address
FROM polymarket.fact_trades_canonical
WHERE block_timestamp > now() - INTERVAL 1 HOUR
```

3. **On-demand refresh** (via API endpoint):
```typescript
// /src/app/api/wallet/[address]/refresh/route.ts
export async function POST(
  request: Request,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  // Fetch latest from API
  const positions = await getAllPositions(address);

  // Insert into ClickHouse
  await insertPositions(positions);

  return Response.json({ success: true, count: positions.length });
}
```

---

## API Rate Limits & Best Practices

### Polymarket Data API
- **No documented rate limits** found
- **Recommendation:** 1 request per second to be safe
- **Batch size:** Max 500 positions per request
- **Pagination:** Use offset parameter

### Goldsky Subgraph
- **No documented rate limits** found
- **Recommendation:** 2 requests per second
- **Batch size:** Max 1000 entities per query
- **Best practice:** Use `skip` for pagination

### Error Handling
```typescript
async function fetchWithRetry<T>(
  fetcher: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetcher();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  throw new Error('Should not reach here');
}
```

---

## Testing & Validation

### Test Cases

1. **Known wallet with UI P&L:**
   - Wallet: 0x4ce73141dbfce41e65db3723e31059a730f0abad
   - Expected: ~$332K in losses
   - Verify: `SELECT sum(cash_pnl) FROM polymarket.wallet_positions_api WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'`

2. **Empty wallet:**
   - Should return 0 positions
   - Should not error

3. **Partial payout market:**
   - Condition with payouts like ["0.54", "0.46"]
   - Verify P&L calculation uses correct payout fraction

4. **Negative risk markets:**
   - Check `negativeRisk` field
   - Verify P&L calculation accounts for this

### Validation Queries

```sql
-- 1. Check data freshness
SELECT
  max(fetched_at) as last_fetch,
  count(DISTINCT wallet_address) as wallets,
  count() as total_positions
FROM polymarket.wallet_positions_api;

-- 2. Find wallets with discrepancies > $1000
SELECT
  wallet_address,
  api_pnl,
  calculated_pnl,
  difference
FROM (
  SELECT
    api.wallet_address,
    api.total_cash_pnl as api_pnl,
    calc.total_pnl_usd as calculated_pnl,
    api.total_cash_pnl - calc.total_pnl_usd as difference
  FROM (
    SELECT wallet_address, sum(cash_pnl) as total_cash_pnl
    FROM polymarket.wallet_positions_api
    GROUP BY wallet_address
  ) api
  LEFT JOIN polymarket.vw_wallet_pnl calc
    ON api.wallet_address = calc.wallet_address
)
WHERE abs(difference) > 1000
ORDER BY abs(difference) DESC;

-- 3. Coverage check
SELECT
  'API Coverage' as metric,
  count(DISTINCT api.wallet_address) as api_wallets,
  count(DISTINCT calc.wallet_address) as calculated_wallets,
  count(DISTINCT api.wallet_address) * 100.0 / count(DISTINCT calc.wallet_address) as coverage_pct
FROM polymarket.wallet_positions_api api
FULL OUTER JOIN polymarket.vw_wallet_pnl calc
  ON api.wallet_address = calc.wallet_address;
```

---

## Troubleshooting

### Issue: API returns 0 positions for active wallet
**Check:**
1. Wallet address format (should be lowercase, 0x-prefixed)
2. API endpoint URL
3. Network connectivity

**Solution:**
```bash
# Test directly with curl
curl "https://data-api.polymarket.com/positions?user=0x4ce73141dbfce41e65db3723e31059a730f0abad&limit=10"
```

### Issue: P&L doesn't match Polymarket UI
**Possible causes:**
1. Partial payouts not handled correctly
2. Negative risk markets calculated wrong
3. Merged positions not aggregated
4. Timestamp differences (API shows real-time, our data might be delayed)

**Solution:**
Compare individual positions:
```sql
SELECT
  condition_id,
  market_title,
  outcome,
  cash_pnl,
  realized_pnl,
  size,
  avg_price
FROM polymarket.wallet_positions_api
WHERE wallet_address = '0x...'
ORDER BY abs(cash_pnl) DESC
LIMIT 20;
```

### Issue: Subgraph returns empty payouts
**Check:**
1. GraphQL query syntax
2. Filter condition (`payouts_not: null`)
3. Endpoint URL

**Solution:**
Test with minimal query:
```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn \
  -H "Content-Type: application/json" \
  -d '{"query": "{conditions(first: 5) {id payouts}}"}'
```

---

## Next Steps After Implementation

1. **Compare accuracy:**
   - Run side-by-side comparison for 100 wallets
   - Document systematic differences
   - Update our P&L calculation if needed

2. **Dashboard integration:**
   - Show API P&L as "Verified"
   - Show calculated P&L as "Estimated"
   - Flag large discrepancies

3. **Alert system:**
   - Email when discrepancy > $10K
   - Slack notification for missing condition IDs
   - Daily summary of data freshness

4. **Performance monitoring:**
   - Track API response times
   - Monitor rate limit issues
   - Alert on stale data (> 24 hours old)

---

## Summary

**What we have:**
- ✅ Working Data API client with full P&L
- ✅ Working Goldsky subgraph client with payout vectors
- ✅ ClickHouse schema for API data
- ✅ Backfill scripts ready to run
- ✅ Validation queries

**What to do next:**
1. Run test script to verify APIs work
2. Backfill test wallet and validate
3. Backfill top 100 wallets
4. Compare and document discrepancies
5. Set up automated sync

**Time estimate:**
- Phase 1 (test wallet): 1 hour
- Phase 2 (top wallets): 2 hours
- Phase 3 (payouts): 1 hour
- Phase 4 (unified view): 30 minutes
- Phase 5 (automation): 1 hour
- **Total: ~5-6 hours** for complete integration

**Expected outcome:**
- Accurate P&L for all wallets
- Source of truth for resolution data
- Validation of our calculations
- Path to fix systematic issues
