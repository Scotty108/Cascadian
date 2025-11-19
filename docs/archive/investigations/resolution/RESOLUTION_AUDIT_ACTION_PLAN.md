# Resolution Data Audit - Action Plan

**Executive Summary:** Database audit completed. Coverage is **69%** not 24.8%. Found 94 additional markets to import. 20 wallets ready for leaderboards.

---

## 🔥 Key Discovery: Coverage Mystery SOLVED

### The 56,575 Number Mystery

**Most Likely Source:** The `onchain` source in `market_resolutions_final`

```
Source breakdown from market_resolutions_final:
- bridge_clob:    77,097 markets
- blockchain:     74,216 markets
- onchain:        57,103 markets  ⬅️ CLOSE TO 56,575!
- gamma:           6,290 markets
- rollup:          3,195 markets
```

**Hypothesis:** The 56,575 figure came from counting only the `onchain` source markets (57,103 is within 528 markets). This was **incomplete** because it excluded:
- bridge_clob source: 77k markets
- blockchain source: 74k markets
- Other sources: 9k markets

**True Coverage:** 157,222 unique markets / 227,838 total = **69.01%** ✅

---

## 📋 Action Items (Prioritized)

### IMMEDIATE (Do Today - 2 hours)

#### 1. Update Coverage Metrics Everywhere (30 min)

**What:** Fix all references to "24.8%" or "56,575" in code/docs

**Where to Check:**
```bash
# Search codebase
grep -r "24.8" .
grep -r "56575" .
grep -r "56,575" .
```

**Locations likely affected:**
- Dashboard components (`src/components/dashboard/`)
- API endpoints (`src/app/api/`)
- Documentation (`*.md` files)
- README files

**Updated Standard Query:**
```sql
-- Use this as the canonical coverage query
SELECT
  count(DISTINCT condition_id_norm) as resolved_markets
FROM market_resolutions_final
WHERE payout_denominator > 0
```

#### 2. Import 94 Missing Markets (1 hour)

**Script to create:**
```typescript
// scripts/import-missing-94-markets.ts

import { getClickHouseClient } from './lib/clickhouse/client'

const client = getClickHouseClient()

async function importMissing94() {
  // Step 1: Extract from staging
  const missing = await client.query({
    query: `
      SELECT DISTINCT
        s.cid,
        s.winning_outcome,
        s.source
      FROM staging_resolutions_union s
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(s.cid, '0x', '')) = lower(replaceAll(m.condition_id_norm, '0x', ''))
      WHERE m.condition_id_norm IS NULL
        AND s.winning_outcome IS NOT NULL
        AND s.winning_outcome != ''
    `,
    format: 'JSONEachRow'
  })

  const data = await missing.json<{cid: string, winning_outcome: string, source: string}>()

  console.log(`Found ${data.length} markets to import`)

  // Step 2: Transform to payout vectors
  // For binary markets: winning_outcome = 'YES' → [1, 0], 'NO' → [0, 1]
  for (const row of data) {
    const payout_numerators = row.winning_outcome.toUpperCase() === 'YES' ? [1, 0] : [0, 1]
    const payout_denominator = 1

    await client.insert({
      table: 'market_resolutions_final',
      values: [{
        condition_id_norm: row.cid.toLowerCase().replace('0x', ''),
        payout_numerators,
        payout_denominator,
        winning_outcome: row.winning_outcome,
        source: row.source,
        resolved_at: new Date()
      }],
      format: 'JSONEachRow'
    })
  }

  console.log(`✅ Imported ${data.length} markets`)
}

importMissing94().catch(console.error)
```

**Run:**
```bash
npx tsx scripts/import-missing-94-markets.ts
```

**Expected Result:** Coverage increases from 69.01% → 69.05%

#### 3. Verify Import Success (30 min)

```bash
npx tsx DEEP_RESOLUTION_ANALYSIS.ts
```

Confirm:
- Total markets with payouts: 157,316 (was 157,222)
- Coverage: 69.05%
- No new markets in staging_resolutions_union gap

---

### SHORT TERM (This Week - 1 day)

#### 4. Ship Wallet Leaderboards (3 hours)

**Wallets Ready Now:** 20 wallets with 80%+ coverage

**Implementation Steps:**

1. **Create leaderboard query** (30 min)
```sql
-- /lib/clickhouse/queries/leaderboard.ts
export const LEADERBOARD_QUERY = `
  WITH wallet_positions AS (
    SELECT
      lower(wallet_address_norm) as wallet,
      lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
      count() as trade_count
    FROM vw_trades_canonical
    WHERE wallet_address_norm IS NOT NULL
      AND condition_id_norm IS NOT NULL
      AND condition_id_norm != ''
    GROUP BY wallet, cid_norm
  ),
  wallet_stats AS (
    SELECT
      wp.wallet,
      count(DISTINCT wp.cid_norm) as total_markets,
      countIf(mrf.condition_id_norm IS NOT NULL) as resolved_markets,
      round(countIf(mrf.condition_id_norm IS NOT NULL) * 100.0 / count(DISTINCT wp.cid_norm), 2) as coverage_pct
    FROM wallet_positions wp
    LEFT JOIN market_resolutions_final mrf
      ON mrf.condition_id_norm = wp.cid_norm
      AND mrf.payout_denominator > 0
    GROUP BY wp.wallet
    HAVING total_markets >= 10
      AND coverage_pct >= 80
      AND coverage_pct <= 100  -- Filter out data quality issues
  )
  SELECT
    ws.wallet,
    ws.total_markets,
    ws.resolved_markets,
    ws.coverage_pct,
    wm.wins,
    wm.losses,
    wm.win_rate_pct,
    wm.pnl_usd
  FROM wallet_stats ws
  LEFT JOIN wallet_metrics wm ON ws.wallet = lower(wm.wallet_address)
  ORDER BY ws.resolved_markets DESC
  LIMIT 100
`
```

2. **Create API endpoint** (1 hour)
```typescript
// src/app/api/leaderboard/route.ts
import { clickhouse } from '@/lib/clickhouse/client'
import { LEADERBOARD_QUERY } from '@/lib/clickhouse/queries/leaderboard'

export async function GET(request: Request) {
  const result = await clickhouse.query({
    query: LEADERBOARD_QUERY,
    format: 'JSONEachRow'
  })

  const leaderboard = await result.json()

  return Response.json({
    success: true,
    data: leaderboard,
    meta: {
      coverage_threshold: '80%',
      min_markets: 10,
      total_wallets: leaderboard.length
    }
  })
}
```

3. **Create UI component** (1.5 hours)
```tsx
// src/components/leaderboard/wallet-leaderboard.tsx
'use client'

import { useEffect, useState } from 'react'

export function WalletLeaderboard() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(res => res.json())
      .then(json => {
        setData(json.data)
        setLoading(false)
      })
  }, [])

  if (loading) return <div>Loading...</div>

  return (
    <div className="leaderboard">
      <h1>Smart Money Leaderboard</h1>
      <p>Wallets with 80%+ resolution coverage (min 10 markets)</p>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Wallet</th>
            <th>Markets</th>
            <th>Resolved</th>
            <th>Win Rate</th>
            <th>P&L</th>
          </tr>
        </thead>
        <tbody>
          {data.map((wallet, idx) => (
            <tr key={wallet.wallet}>
              <td>{idx + 1}</td>
              <td>{wallet.wallet.slice(0, 10)}...</td>
              <td>{wallet.total_markets}</td>
              <td>{wallet.resolved_markets}</td>
              <td>{wallet.win_rate_pct}%</td>
              <td>${wallet.pnl_usd?.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

4. **Add to dashboard** (30 min)
- Add route in `src/app/leaderboard/page.tsx`
- Add navigation link in sidebar
- Test with sample data

#### 5. Investigate >100% Coverage Wallets (2 hours)

**Issue:** Some wallets show 131% coverage (impossible)

**Debug Script:**
```typescript
// scripts/debug-overcoverage-wallets.ts

const wallets_over_100 = [
  '0x912a58103662ebe2e30328a305bc33131eca0f92', // 131.72%
  '0xf0b0ef1d6320c6be896b4c9c54dd74407e7f8cab'  // 100.14%
]

for (const wallet of wallets_over_100) {
  // Count unique markets traded
  const traded = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as markets
      FROM vw_trades_canonical
      WHERE lower(wallet_address_norm) = '${wallet}'
    `
  })

  // Count unique resolutions joined
  const resolved = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as markets
      FROM vw_trades_canonical t
      INNER JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
      WHERE lower(t.wallet_address_norm) = '${wallet}'
        AND r.payout_denominator > 0
    `
  })

  console.log(`Wallet: ${wallet}`)
  console.log(`  Traded markets: ${traded}`)
  console.log(`  Resolved markets: ${resolved}`)
  console.log(`  Ratio: ${resolved / traded}`)

  // Check for duplicates in resolution table
  const dupes = await client.query({
    query: `
      SELECT
        condition_id_norm,
        count() as duplicate_count
      FROM market_resolutions_final
      WHERE condition_id_norm IN (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', ''))
        FROM vw_trades_canonical
        WHERE lower(wallet_address_norm) = '${wallet}'
      )
      GROUP BY condition_id_norm
      HAVING duplicate_count > 1
      ORDER BY duplicate_count DESC
      LIMIT 10
    `
  })

  console.log(`  Duplicate resolutions found: ${dupes.length}`)
}
```

**Possible Fixes:**
1. If duplicates found: deduplicate `market_resolutions_final` table
2. If join issue: fix condition ID normalization in join
3. If data quality: filter these wallets from leaderboard

---

### MEDIUM TERM (Next 2 Weeks)

#### 6. Database View Cleanup (1 week)

**Problem:** 92 views, many redundant

**Phase 1: Audit (2 hours)**
```bash
# Create view usage tracker
grep -r "vw_" src/ --include="*.ts" --include="*.tsx" | \
  awk -F: '{print $2}' | \
  grep -o "vw_[a-z_]*" | \
  sort | uniq -c | sort -rn > view_usage_stats.txt
```

**Phase 2: Document (4 hours)**
- Map each view to its purpose
- Identify unused views
- Find redundant view chains

**Phase 3: Consolidate (2 days)**
- Merge P&L view variants (10+ versions)
- Standardize on 3-5 canonical views
- Archive deprecated views

**Phase 4: Optimize (3 days)**
- Materialize frequently-accessed views
- Add indexes to underlying tables
- Benchmark query performance

#### 7. Coverage Improvement Research (3 days)

**Goal:** Understand the remaining 30.95% (70k unresolved markets)

**Analysis:**
```sql
-- Categorize unresolved markets
WITH unresolved AS (
  SELECT
    tcm.condition_id_32b,
    tcm.market_id,
    count(*) as trade_count
  FROM token_condition_market_map tcm
  LEFT JOIN market_resolutions_final mrf
    ON lower(tcm.condition_id_32b) = lower(replaceAll(mrf.condition_id_norm, '0x', ''))
  WHERE mrf.condition_id_norm IS NULL
  GROUP BY tcm.condition_id_32b, tcm.market_id
)
SELECT
  CASE
    WHEN trade_count = 0 THEN 'Never traded'
    WHEN trade_count < 10 THEN 'Low volume'
    WHEN trade_count < 100 THEN 'Medium volume'
    ELSE 'High volume'
  END as category,
  count() as market_count
FROM unresolved
GROUP BY category
```

**Questions to Answer:**
1. How many are still open (not yet resolved)?
2. How many are invalid/canceled markets?
3. How many have resolution data available elsewhere (APIs)?
4. How many are worth backfilling?

---

## 📊 Success Metrics

| Metric | Before | After Phase 1 | Target (2 weeks) |
|--------|--------|---------------|------------------|
| Coverage % | 69.01% | 69.05% | 72% |
| Resolved markets | 157,222 | 157,316 | 164,000 |
| Wallet leaderboard | None | 20 wallets | 100 wallets |
| View count | 92 | 92 | 50 |
| Documentation accuracy | 24.8% (wrong) | 69% (correct) | 100% |

---

## 🔍 Open Questions

1. **Blockchain data:** Are there ERC1155 redemption events we're missing?
2. **API coverage:** Can we import more from Polymarket's API?
3. **Historical data:** Are pre-2023 markets worth backfilling?
4. **Data quality:** How to handle >100% coverage wallets?
5. **Performance:** Do we need to materialize views for production?

---

## 📚 Reference Files

**Audit Scripts:**
- `COMPREHENSIVE_DATABASE_AUDIT.ts` - Full table scan
- `DEEP_RESOLUTION_ANALYSIS.ts` - Resolution data deep dive
- `VERIFY_COVERAGE_MYSTERY.ts` - 56,575 investigation

**Results:**
- `DATABASE_AUDIT_RESULTS.txt` - Raw scan output
- `DEEP_RESOLUTION_ANALYSIS_RESULTS.txt` - Coverage analysis
- `COVERAGE_MYSTERY_RESULTS.txt` - Source investigation

**Reports:**
- `DATABASE_AUDIT_EXECUTIVE_REPORT.md` - Full findings
- `RESOLUTION_AUDIT_ACTION_PLAN.md` - This document

**Key Queries:**
- Coverage: `SELECT count(DISTINCT condition_id_norm) FROM market_resolutions_final WHERE payout_denominator > 0`
- Missing markets: See import script above
- Leaderboard: See `/lib/clickhouse/queries/leaderboard.ts`

---

## ✅ Completion Checklist

**Today:**
- [ ] Search codebase for "24.8%" and "56,575" references
- [ ] Update all coverage metrics to 69%
- [ ] Create and run import-missing-94-markets.ts
- [ ] Verify coverage increased to 69.05%

**This Week:**
- [ ] Create leaderboard query file
- [ ] Build API endpoint for leaderboard
- [ ] Design UI component
- [ ] Add to dashboard navigation
- [ ] Debug >100% coverage wallets
- [ ] Filter overcoverage wallets from leaderboard

**Next 2 Weeks:**
- [ ] Audit view usage
- [ ] Document all 92 views
- [ ] Consolidate redundant views
- [ ] Analyze unresolved markets
- [ ] Research additional data sources
- [ ] Optimize frequently-used queries

---

**Last Updated:** 2025-01-XX
**Audit Coverage:** 148 tables, 92 views, 38 resolution objects
**Critical Finding:** Coverage is 69%, not 24.8%
**Quick Wins:** Import 94 markets, ship 20-wallet leaderboard
