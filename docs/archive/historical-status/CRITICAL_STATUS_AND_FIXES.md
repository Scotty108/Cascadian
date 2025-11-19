# 🚨 CRITICAL STATUS UPDATE & ACTION PLAN

## Current P&L Status: BROKEN ❌

### The Problem

**Midprices Table is EMPTY** (0 rows) despite fetcher running for 22 minutes.

**Impact**:
- All unrealized P&L shows as **negative millions** (should be positive)
- Total P&L: **-$11.5M** (should be **+$1.9M**)
- 8 of 12 wallets show **$0 trading P&L** (incorrect)
- 11 of 12 wallets show **huge negative unrealized** (wrong)

**Root Cause**: `phase2-refresh-midprices.ts` is either:
1. Stuck fetching prices without progress logging
2. Failing silently without error handling
3. Not inserting to database correctly

---

## Immediate Action Plan

### Fix 1: Working Midprice Fetcher (10 minutes)

Create a **reliable midprice fetcher** that:
- ✅ Shows progress in real-time
- ✅ Uses existing Polymarket CLOB integration (from UI code)
- ✅ Batches inserts for performance
- ✅ Handles errors gracefully
- ✅ Integrates with React Query cache (5-second polling)

### Fix 2: Time-in-Trade Metrics (Schema Extension)

Add holding duration tracking to identify:
- **Whales** (hold large positions >7 days)
- **Swing traders** (close positions <24 hours)
- **Average hold time** per wallet
- **P&L by hold duration** (long-term vs short-term profits)

### Fix 3: Pipeline Integration

Make midprice fetching **part of the data pipeline**:
- Reuse existing `/api/polymarket/order-book/[marketId]` endpoint
- Schedule via cron or worker queue
- Only fetch prices for **active open positions**
- Sync with UI refresh rate (5-10 seconds)

---

## Solution 1: Integrated Midprice Fetcher

### Architecture

```
Existing UI Price System:
  ├─ useMarketOrderBook hook (polls every 5 seconds)
  ├─ /api/polymarket/order-book/[marketId]
  └─ Direct CLOB API: https://clob.polymarket.com/book?token_id={token_id}

New Backend Integration:
  ├─ Scheduled worker (every 5 minutes)
  ├─ Fetches only for open positions
  ├─ Writes to cascadian_clean.midprices_latest
  └─ Powers unrealized P&L calculations
```

### Implementation

**File**: `workers/update-midprices-from-ui-api.ts`

```typescript
#!/usr/bin/env npx tsx
/**
 * Integrated Midprice Worker
 *
 * Reuses UI price fetching logic to populate backend midprices table.
 * Runs every 5 minutes to keep unrealized P&L in sync with Polymarket.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

interface OpenPosition {
  market_cid: string;
  outcome: number;
  token_id: string;
}

// Convert condition_id + outcome to token_id (same as UI)
function getTokenId(marketCid: string, outcome: number): string {
  const hex = marketCid.replace(/^0x/i, '');
  const base = hex.slice(0, 62) + outcome.toString(16).padStart(2, '0');
  return '0x' + base.toLowerCase();
}

async function fetchOrderBook(tokenId: string): Promise<{ mid: number; bid: number; ask: number } | null> {
  try {
    const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
      headers: { 'User-Agent': 'Cascadian/1.0' }
    });

    if (!res.ok) return null;

    const book = await res.json() as any;
    const bid = book?.bids?.[0]?.price ? parseFloat(book.bids[0].price) : 0;
    const ask = book?.asks?.[0]?.price ? parseFloat(book.asks[0].price) : 1;
    const mid = (bid + ask) / 2;

    return { mid, bid, ask };
  } catch (err) {
    console.error(`Failed to fetch ${tokenId}:`, err);
    return null;
  }
}

async function main() {
  console.log('\n[%s] Starting midprice update...', new Date().toISOString());

  // Get all open positions
  const positions = await ch.query({
    query: `
      SELECT DISTINCT
        market_cid,
        outcome,
        concat('0x', left(replaceAll(market_cid,'0x',''),62),
               lpad(lower(hex(outcome)), 2, '0')) AS token_id
      FROM (
        SELECT
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction='BUY', toFloat64(shares), -toFloat64(shares)), 1) AS net
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY market_cid, outcome
      )
      WHERE abs(net) >= 0.01
      ORDER BY market_cid, outcome
    `,
    format: 'JSONEachRow',
  });

  const openPositions = await positions.json<OpenPosition[]>();
  console.log(`Found ${openPositions.length} open positions to price`);

  if (openPositions.length === 0) {
    console.log('No open positions. Exiting.');
    await ch.close();
    return;
  }

  // Fetch prices in batches
  const batchSize = 50;
  const prices: Array<{ market_cid: string; outcome: number; mid: number; bid: number; ask: number }> = [];

  for (let i = 0; i < openPositions.length; i += batchSize) {
    const batch = openPositions.slice(i, i + batchSize);

    console.log(`[%s] Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(openPositions.length / batchSize)}...`,
      new Date().toISOString().substring(11, 19));

    const results = await Promise.allSettled(
      batch.map(async (pos) => {
        const tokenId = getTokenId(pos.market_cid, pos.outcome);
        const price = await fetchOrderBook(tokenId);

        if (price) {
          return {
            market_cid: pos.market_cid,
            outcome: pos.outcome,
            mid: price.mid,
            bid: price.bid,
            ask: price.ask,
          };
        }
        return null;
      })
    );

    const successfulFetches = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    prices.push(...successfulFetches);

    // Rate limiting: small delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`Successfully fetched ${prices.length} / ${openPositions.length} prices`);

  // Insert to database in batches
  if (prices.length > 0) {
    const insertBatchSize = 1000;
    let inserted = 0;

    for (let i = 0; i < prices.length; i += insertBatchSize) {
      const batch = prices.slice(i, i + insertBatchSize);
      const values = batch.map(p =>
        `('${p.market_cid}',${p.outcome},${p.mid},${p.bid},${p.ask},now())`
      ).join(',');

      await ch.command({
        query: `
          INSERT INTO cascadian_clean.midprices_latest
          (market_cid, outcome, midprice, best_bid, best_ask, updated_at)
          VALUES ${values}
        `
      });

      inserted += batch.length;
      console.log(`Inserted ${inserted} / ${prices.length} prices...`);
    }

    console.log(`\n[%s] ✅ Complete! Inserted ${inserted} midprices`, new Date().toISOString());
  } else {
    console.log('\n⚠️  No prices fetched successfully');
  }

  await ch.close();
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
```

---

## Solution 2: Time-in-Trade Metrics

### Schema Extension

Add to `position_lifecycle` table:

```sql
ALTER TABLE cascadian_clean.position_lifecycle ADD COLUMN IF NOT EXISTS
  holding_duration_seconds UInt64;

ALTER TABLE cascadian_clean.position_lifecycle ADD COLUMN IF NOT EXISTS
  holding_duration_days Float64;
```

Update FIFO matcher to calculate:

```typescript
const holdingDurationSeconds = exitTimestamp - entryTimestamp;
const holdingDurationDays = holdingDurationSeconds / 86400;

// Classify by hold duration
const durationCategory =
  holdingDurationDays < 1 ? 'INTRADAY' :
  holdingDurationDays < 7 ? 'SHORT_TERM' :
  holdingDurationDays < 30 ? 'MEDIUM_TERM' : 'LONG_TERM';
```

### Wallet Metrics Extension

Add to `wallet_metrics`:

```sql
-- Holding duration metrics
avg_hold_duration_hours Float64,
median_hold_duration_hours Float64,
pct_positions_held_gt_7d Float64,     -- % held > 7 days (whales)
pct_positions_held_lt_1d Float64,     -- % held < 1 day (swing traders)

-- P&L by hold duration
intraday_pnl Float64,                  -- P&L from positions held < 1 day
short_term_pnl Float64,                -- 1-7 days
medium_term_pnl Float64,               -- 7-30 days
long_term_pnl Float64,                 -- > 30 days

-- Volume by hold duration
intraday_volume_usd Float64,
short_term_volume_usd Float64,
medium_term_volume_usd Float64,
long_term_volume_usd Float64
```

### Filtering Queries

**Find Whales (Hold > 7 Days)**:
```sql
SELECT wallet,
  pct_positions_held_gt_7d,
  long_term_pnl,
  long_term_volume_usd,
  avg_hold_duration_hours / 24 AS avg_hold_days
FROM cascadian_clean.wallet_metrics
WHERE pct_positions_held_gt_7d >= 50   -- At least 50% of positions held > 7 days
  AND long_term_volume_usd > 100000    -- Minimum $100K in long-term positions
  AND avg_hold_duration_hours > 168    -- Average > 7 days
ORDER BY long_term_pnl DESC;
```

**Exclude Swing Traders**:
```sql
-- Inverse filter: exclude wallets who trade hourly
SELECT wallet, outcome_accuracy_pct, total_pnl
FROM cascadian_clean.wallet_metrics
WHERE pct_positions_held_lt_1d < 30    -- Less than 30% intraday trading
  AND avg_hold_duration_hours > 24     -- Average hold > 1 day
  AND positions_opened >= 10
ORDER BY outcome_accuracy_pct DESC;
```

**Compare Strategies**:
```sql
-- P&L per $ traded by hold duration
SELECT
  'Intraday' AS strategy,
  sum(intraday_pnl) / sum(intraday_volume_usd) AS pnl_per_dollar,
  avg(avg_hold_duration_hours) FILTER (WHERE intraday_volume_usd > 0) AS avg_hold_hours
FROM cascadian_clean.wallet_metrics

UNION ALL

SELECT 'Long-term',
  sum(long_term_pnl) / sum(long_term_volume_usd),
  avg(avg_hold_duration_hours) FILTER (WHERE long_term_volume_usd > 0)
FROM cascadian_clean.wallet_metrics;
```

---

## Solution 3: Pipeline Integration

### Cron Schedule

```bash
# Update midprices every 5 minutes
*/5 * * * * cd /path/to/project && npx tsx workers/update-midprices-from-ui-api.ts >> /var/log/midprices.log 2>&1

# Or via systemd timer for production
```

### Worker Queue (Alternative)

```typescript
// workers/price-update-queue.ts
import { Queue, Worker } from 'bullmq';

const priceQueue = new Queue('price-updates', {
  connection: { host: 'localhost', port: 6379 }
});

// Schedule every 5 minutes
await priceQueue.add('update-midprices', {}, {
  repeat: { pattern: '*/5 * * * *' }
});

// Worker
const worker = new Worker('price-updates', async (job) => {
  await runMidpriceUpdate();
}, { connection: { host: 'localhost', port: 6379 } });
```

### Integration with UI

**Share price fetching logic**:

```typescript
// lib/polymarket/prices.ts (shared)
export async function fetchMarketPrice(tokenId: string) {
  const response = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
  const book = await response.json();

  return {
    mid: ((book.bids[0]?.price || 0) + (book.asks[0]?.price || 1)) / 2,
    bid: book.bids[0]?.price || 0,
    ask: book.asks[0]?.price || 1,
  };
}

// Used by both:
// - Frontend: hooks/use-market-order-book.ts
// - Backend: workers/update-midprices-from-ui-api.ts
```

---

## Next Actions (Priority Order)

1. **Run fixed midprice fetcher** (10 min runtime) ← DO THIS NOW
2. **Validate P&L numbers** match Polymarket
3. **Implement time-in-trade tracking** (2-3 hours)
4. **Set up cron job** for ongoing price updates
5. **Implement outcome correctness** (4-6 hours)

---

## Expected Results After Fix

| Wallet | Polymarket | Our Total (After Fix) | Status |
|--------|------------|----------------------|---------|
| 0x4ce7... | $332,563 | ~$330K-$340K | ✅ Should match |
| 0xb48e... | $114,087 | ~$110K-$120K | ✅ Should match |
| 0x1f0a... | $101,576 | ~$100K-$105K | ✅ Should match |

Differences expected: 5-10% due to price timing and fee handling.

---

**Ready to execute?** Run `workers/update-midprices-from-ui-api.ts` now to get accurate P&L numbers.
