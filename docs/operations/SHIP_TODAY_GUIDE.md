# 🚀 Ship Today: 15-Minute Deployment Guide

**Goal:** Get a working P&L dashboard live in < 15 minutes using the data you already have

---

## Step 1: Create Canonical Trades Table (5 minutes)

Run this script to create your production-ready trades table:

```sql
-- Create the canonical trades table with normalized condition_ids
CREATE TABLE trades_canonical
ENGINE = ReplacingMergeTree()
ORDER BY (condition_id_norm, wallet_address, block_time, tx_hash)
PARTITION BY toYYYYMM(block_time)
AS
SELECT
  -- Normalize condition_id: strip 0x prefix and lowercase
  lower(substring(condition_id_norm, 3)) as condition_id_norm,

  -- Transaction identifiers
  tx_hash,
  computed_at as block_time,

  -- Wallet
  wallet_address,

  -- Market identifiers
  market_id,
  outcome_index,
  side_token as token_id,

  -- Trade details
  CAST(direction_from_transfers AS Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 0)) as direction,
  shares,
  price,
  usd_value,

  -- Quality indicators
  CAST(confidence AS Enum8('HIGH' = 3, 'MEDIUM' = 2, 'LOW' = 1, 'UNKNOWN' = 0)) as confidence,
  data_source,

  -- Metadata
  reason,
  recovery_status,
  computed_at as created_at

FROM trades_with_direction
WHERE length(condition_id_norm) = 66;  -- Only process valid 0x-prefixed IDs
```

**Expected result:** 81,822,927 rows created

---

## Step 2: Create P&L View (3 minutes)

Create a materialized view that joins trades to resolutions:

```sql
CREATE MATERIALIZED VIEW trades_with_pnl
ENGINE = ReplacingMergeTree()
ORDER BY (wallet_address, block_time)
PARTITION BY toYYYYMM(block_time)
AS
SELECT
  -- All trade fields
  t.tx_hash,
  t.block_time,
  t.wallet_address,
  t.condition_id_norm,
  t.market_id,
  t.outcome_index,
  t.direction,
  t.shares,
  t.price,
  t.usd_value,

  -- Resolution data
  r.winning_outcome,
  r.winning_index,
  r.payout_numerators,
  r.payout_denominator,
  r.resolved_at,

  -- P&L calculation
  multiIf(
    r.winning_index IS NULL, NULL,  -- Not resolved yet
    t.direction = 'BUY', t.shares * (arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator) - t.usd_value,
    t.direction = 'SELL', t.usd_value - t.shares * (arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator),
    NULL
  ) as realized_pnl_usd,

  now() as updated_at

FROM trades_canonical t
LEFT JOIN market_resolutions_final r
  ON t.condition_id_norm = r.condition_id_norm;
```

---

## Step 3: Test Queries (2 minutes)

### Top Wallets by P&L

```sql
SELECT
  wallet_address,
  count() as total_trades,
  sum(realized_pnl_usd) as total_pnl,
  sum(usd_value) as total_volume,
  countIf(realized_pnl_usd > 0) as winning_trades,
  countIf(realized_pnl_usd < 0) as losing_trades,
  winning_trades * 100.0 / total_trades as win_rate
FROM trades_with_pnl
WHERE resolved_at IS NOT NULL
GROUP BY wallet_address
HAVING total_trades > 10
ORDER BY total_pnl DESC
LIMIT 100;
```

### Market Performance

```sql
SELECT
  m.question,
  count(DISTINCT t.wallet_address) as unique_traders,
  count() as total_trades,
  sum(t.usd_value) as total_volume,
  r.winning_outcome,
  r.resolved_at
FROM trades_with_pnl t
LEFT JOIN market_key_map m ON t.condition_id_norm = lower(substring(m.condition_id, 3))
LEFT JOIN market_resolutions_final r ON t.condition_id_norm = r.condition_id_norm
WHERE r.resolved_at IS NOT NULL
GROUP BY m.question, r.winning_outcome, r.resolved_at
ORDER BY total_volume DESC
LIMIT 50;
```

### Your P&L (replace with your wallet)

```sql
SELECT
  m.question,
  t.direction,
  t.shares,
  t.price,
  t.usd_value,
  r.winning_outcome,
  t.realized_pnl_usd,
  t.block_time
FROM trades_with_pnl t
LEFT JOIN market_key_map m ON t.condition_id_norm = lower(substring(m.condition_id, 3))
LEFT JOIN market_resolutions_final r ON t.condition_id_norm = r.condition_id_norm
WHERE t.wallet_address = 'YOUR_WALLET_HERE'
  AND r.resolved_at IS NOT NULL
ORDER BY t.block_time DESC
LIMIT 100;
```

---

## Step 4: API Endpoints (5 minutes)

Create these API routes in your Next.js app:

### `/api/wallet/[address]/pnl`

```typescript
// src/app/api/wallet/[address]/pnl/route.ts
import { clickhouse } from '@/lib/clickhouse/client';

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  const result = await clickhouse.query({
    query: `
      SELECT
        sum(realized_pnl_usd) as total_pnl,
        sum(usd_value) as total_volume,
        count() as total_trades,
        countIf(realized_pnl_usd > 0) as winning_trades,
        countIf(realized_pnl_usd < 0) as losing_trades
      FROM trades_with_pnl
      WHERE wallet_address = {address:String}
        AND resolved_at IS NOT NULL
    `,
    query_params: { address: address.toLowerCase() },
    format: 'JSONEachRow',
  });

  const data = await result.json();
  return Response.json(data[0] || {});
}
```

### `/api/markets/top`

```typescript
// src/app/api/markets/top/route.ts
import { clickhouse } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  const result = await clickhouse.query({
    query: `
      SELECT
        t.condition_id_norm,
        any(m.question) as question,
        count(DISTINCT t.wallet_address) as unique_traders,
        sum(t.usd_value) as total_volume,
        any(r.winning_outcome) as winning_outcome
      FROM trades_with_pnl t
      LEFT JOIN market_key_map m ON t.condition_id_norm = lower(substring(m.condition_id, 3))
      LEFT JOIN market_resolutions_final r ON t.condition_id_norm = r.condition_id_norm
      WHERE r.resolved_at IS NOT NULL
      GROUP BY t.condition_id_norm
      ORDER BY total_volume DESC
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });

  return Response.json(await result.json());
}
```

---

## Step 5: Frontend Component (Optional)

Quick React component to display wallet P&L:

```typescript
// src/components/WalletPnL.tsx
'use client';
import { useEffect, useState } from 'react';

export function WalletPnL({ address }: { address: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/wallet/${address}/pnl`)
      .then(res => res.json())
      .then(setData);
  }, [address]);

  if (!data) return <div>Loading...</div>;

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Wallet P&L</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-gray-600">Total P&L</p>
          <p className={`text-3xl font-bold ${data.total_pnl > 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${data.total_pnl?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-gray-600">Total Volume</p>
          <p className="text-3xl font-bold">
            ${data.total_volume?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-gray-600">Win Rate</p>
          <p className="text-3xl font-bold">
            {((data.winning_trades / data.total_trades) * 100).toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-gray-600">Total Trades</p>
          <p className="text-3xl font-bold">{data.total_trades}</p>
        </div>
      </div>
    </div>
  );
}
```

---

## Quick Start Script

Save this as `quick-start.sh`:

```bash
#!/bin/bash

echo "🚀 Creating canonical trades table..."
npx tsx scripts/create-trades-canonical.ts

echo "✅ Trades table created!"
echo ""
echo "📊 Testing queries..."
npx tsx scripts/test-pnl-queries.ts

echo ""
echo "✅ All done! Your data is ready."
echo ""
echo "Next steps:"
echo "1. Start your Next.js dev server: npm run dev"
echo "2. Navigate to /api/markets/top to see top markets"
echo "3. Navigate to /api/wallet/YOUR_WALLET/pnl to see your P&L"
```

---

## Verification Checklist

- [ ] trades_canonical has ~82M rows
- [ ] trades_with_pnl view created successfully
- [ ] Test query returns top wallets by P&L
- [ ] API endpoint `/api/markets/top` returns data
- [ ] API endpoint `/api/wallet/[address]/pnl` returns data
- [ ] Frontend component displays wallet P&L

---

## What You Get

✅ **82M trades** ready for analysis
✅ **224K markets** with resolution data
✅ **937K wallets** tracked
✅ **Full P&L calculation** for resolved markets
✅ **API endpoints** ready to use
✅ **React components** for dashboard

---

## Troubleshooting

### "trades_canonical already exists"

```sql
DROP TABLE IF EXISTS trades_canonical;
-- Then re-run the CREATE TABLE command
```

### "No data returned from API"

Check ClickHouse connection:
```typescript
console.log(process.env.CLICKHOUSE_HOST);
console.log(process.env.CLICKHOUSE_USER);
```

### "P&L values look wrong"

Verify payout vector indexing (ClickHouse arrays are 1-indexed):
```sql
SELECT
  arrayElement(payout_numerators, 1) as first_outcome,  -- NOT index 0!
  arrayElement(payout_numerators, 2) as second_outcome
FROM market_resolutions_final
LIMIT 5;
```

---

## Next Steps After Launch

1. **Add unrealized P&L** for open positions
2. **Add market price history** (from trades aggregated hourly)
3. **Add smart money tracking** (wallet scoring)
4. **Add strategy builder** (visual rule composer)

But for now: **Ship it!** 🚀

---

## Time Breakdown

- Step 1: Create trades_canonical - **5 minutes**
- Step 2: Create P&L view - **3 minutes**
- Step 3: Test queries - **2 minutes**
- Step 4: API endpoints - **5 minutes**
- Step 5: Frontend (optional) - **10 minutes**

**Total: 15-25 minutes to working dashboard**

---

## Support

If you run into issues:
1. Check `UPDATED_SMOKING_GUN_FINDINGS.md` for data quality notes
2. Check `MINIMAL_SCHEMA_DESIGN.md` for schema reference
3. Verify ClickHouse connection with `npx tsx scripts/test-connection.ts`

**You've got this! The data is solid. Time to ship.** 🎯
