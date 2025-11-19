# Leaderboard API Integration Guide

## Overview

This guide shows how to integrate the wallet metrics and leaderboard system into your frontend application.

**Last Updated:** 2025-11-11
**Version:** 1.0

---

## Quick Start

### 1. Install ClickHouse Client

```bash
npm install @clickhouse/client
```

### 2. Configure Client

```typescript
// lib/clickhouse/client.ts
import { createClient } from '@clickhouse/client';

export function getClickHouseClient() {
  return createClient({
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DB || 'default',
  });
}
```

### 3. Fetch Leaderboard Data

```typescript
// Example: Get top 10 whales
import { getClickHouseClient } from '@/lib/clickhouse/client';

export async function getWhaleLeaderboard(limit = 10) {
  const ch = getClickHouseClient();

  const query = `
    SELECT
      rank,
      wallet_address,
      realized_pnl,
      roi_pct,
      total_trades,
      markets_traded,
      win_rate
    FROM default.whale_leaderboard
    ORDER BY rank
    LIMIT ${limit}
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const data = await result.json<LeaderboardEntry[]>();

  await ch.close();
  return data;
}

interface LeaderboardEntry {
  rank: number;
  wallet_address: string;
  realized_pnl: number;
  roi_pct: number;
  total_trades: number;
  markets_traded: number;
  win_rate: number;
}
```

---

## API Routes

### Create Next.js API Routes

#### `/app/api/leaderboard/whales/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10');

  const ch = getClickHouseClient();

  try {
    const query = `
      SELECT
        rank,
        wallet_address,
        realized_pnl,
        roi_pct,
        total_trades,
        markets_traded,
        win_rate
      FROM default.whale_leaderboard
      ORDER BY rank
      LIMIT ${limit}
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    return NextResponse.json({
      success: true,
      data,
      count: data.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    await ch.close();
  }
}
```

#### `/app/api/leaderboard/omega/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10');

  const ch = getClickHouseClient();

  try {
    const query = `
      SELECT
        rank,
        wallet_address,
        omega_ratio,
        sharpe_ratio,
        total_trades,
        win_rate,
        realized_pnl
      FROM default.omega_leaderboard
      ORDER BY rank
      LIMIT ${limit}
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    return NextResponse.json({
      success: true,
      data,
      count: data.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    await ch.close();
  }
}
```

#### `/app/api/wallet/[address]/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const ch = getClickHouseClient();

  try {
    const query = `
      SELECT
        time_window,
        realized_pnl,
        unrealized_payout,
        realized_pnl + unrealized_payout as total_pnl,
        roi_pct,
        win_rate,
        sharpe_ratio,
        omega_ratio,
        total_trades,
        markets_traded,
        calculated_at
      FROM default.wallet_metrics
      WHERE wallet_address = '${params.address.toLowerCase()}'
      ORDER BY
        CASE time_window
          WHEN '30d' THEN 1
          WHEN '90d' THEN 2
          WHEN '180d' THEN 3
          WHEN 'lifetime' THEN 4
        END
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    if (data.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Wallet not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      wallet_address: params.address.toLowerCase(),
      metrics: data,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    await ch.close();
  }
}
```

---

## Frontend Components

### React Component Example

```typescript
'use client';

import { useEffect, useState } from 'react';

interface LeaderboardEntry {
  rank: number;
  wallet_address: string;
  realized_pnl: number;
  roi_pct: number;
  total_trades: number;
  markets_traded: number;
  win_rate: number;
}

export function WhaleLeaderboard() {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const response = await fetch('/api/leaderboard/whales?limit=10');
        const result = await response.json();

        if (result.success) {
          setData(result.data);
        } else {
          setError(result.error);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboard();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Rank
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Wallet
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              P&L
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              ROI
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Trades
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Win Rate
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map((entry) => (
            <tr key={entry.wallet_address}>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                #{entry.rank}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                {entry.wallet_address.slice(0, 10)}...
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                ${parseFloat(entry.realized_pnl).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                {parseFloat(entry.roi_pct).toFixed(2)}%
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                {entry.total_trades.toLocaleString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                {(parseFloat(entry.win_rate) * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## Data Fetching Patterns

### Server-Side Rendering (SSR)

```typescript
// app/leaderboard/page.tsx
import { getClickHouseClient } from '@/lib/clickhouse/client';

export default async function LeaderboardPage() {
  const ch = getClickHouseClient();

  const query = `
    SELECT * FROM default.whale_leaderboard
    ORDER BY rank
    LIMIT 50
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const leaderboard = await result.json();

  await ch.close();

  return (
    <div>
      <h1>Top Whales</h1>
      <LeaderboardTable data={leaderboard} />
    </div>
  );
}
```

### Client-Side with SWR

```typescript
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useLeaderboard(type: 'whales' | 'omega' | 'roi', limit = 10) {
  const { data, error, isLoading } = useSWR(
    `/api/leaderboard/${type}?limit=${limit}`,
    fetcher,
    {
      refreshInterval: 60000, // Refresh every 60 seconds
      revalidateOnFocus: false
    }
  );

  return {
    leaderboard: data?.data || [],
    isLoading,
    isError: error
  };
}

// Usage
function MyComponent() {
  const { leaderboard, isLoading, isError } = useLeaderboard('whales', 10);

  if (isLoading) return <div>Loading...</div>;
  if (isError) return <div>Error loading data</div>;

  return <LeaderboardTable data={leaderboard} />;
}
```

### Incremental Static Regeneration (ISR)

```typescript
// app/leaderboard/page.tsx
export const revalidate = 3600; // Revalidate every hour

export default async function LeaderboardPage() {
  // ... fetch data as in SSR example
}
```

---

## Response Formats

### Successful Response

```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "wallet_address": "0x4bfb41d5b3570deb889c5b1b4d....",
      "realized_pnl": 3539088032.63,
      "roi_pct": 0.00,
      "total_trades": 156789,
      "markets_traded": 245,
      "win_rate": 0.6234
    }
  ],
  "count": 1,
  "timestamp": "2025-11-11T12:00:00.000Z"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Wallet not found"
}
```

---

## Performance Optimization

### Caching Strategy

```typescript
// Use Next.js cache with revalidation
import { unstable_cache } from 'next/cache';

export const getWhaleLeaderboard = unstable_cache(
  async (limit: number) => {
    const ch = getClickHouseClient();
    // ... query logic
    return data;
  },
  ['whale-leaderboard'],
  {
    revalidate: 3600, // Cache for 1 hour
    tags: ['leaderboard']
  }
);
```

### Query Optimization

```typescript
// Use prepared queries for repeated calls
const WHALE_QUERY = `
  SELECT rank, wallet_address, realized_pnl, roi_pct,
         total_trades, markets_traded, win_rate
  FROM default.whale_leaderboard
  ORDER BY rank
  LIMIT {limit:UInt32}
`;

export async function getWhaleLeaderboard(limit = 10) {
  const ch = getClickHouseClient();
  const result = await ch.query({
    query: WHALE_QUERY,
    query_params: { limit },
    format: 'JSONEachRow'
  });
  return result.json();
}
```

---

## Error Handling

### Graceful Degradation

```typescript
export async function getLeaderboardWithFallback(type: string) {
  try {
    const ch = getClickHouseClient();
    const result = await ch.query({ query: `...`, format: 'JSONEachRow' });
    const data = await result.json();
    await ch.close();
    return { success: true, data };

  } catch (error: any) {
    console.error(`Leaderboard fetch error:`, error);

    // Return empty data instead of crashing
    return {
      success: false,
      data: [],
      error: error.message
    };
  }
}
```

### Retry Logic

```typescript
async function queryWithRetry(query: string, maxRetries = 3) {
  const ch = getClickHouseClient();

  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const data = await result.json();
      await ch.close();
      return data;

    } catch (error: any) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

---

## Security Considerations

### Input Validation

```typescript
function validateWalletAddress(address: string): boolean {
  // Must be 42 chars starting with 0x
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function getWalletMetrics(address: string) {
  if (!validateWalletAddress(address)) {
    throw new Error('Invalid wallet address format');
  }

  // Safe to use in query (already validated)
  const query = `
    SELECT * FROM default.wallet_metrics
    WHERE wallet_address = '${address.toLowerCase()}'
  `;
  // ... execute query
}
```

### Rate Limiting

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'), // 10 requests per 10 seconds
});

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429 }
    );
  }

  // ... proceed with query
}
```

---

## Testing

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { getWhaleLeaderboard } from '@/lib/api/leaderboard';

describe('Leaderboard API', () => {
  it('should return top 10 whales', async () => {
    const data = await getWhaleLeaderboard(10);

    expect(data).toHaveLength(10);
    expect(data[0].rank).toBe(1);
    expect(data[0].realized_pnl).toBeGreaterThan(0);
  });

  it('should have sequential rankings', async () => {
    const data = await getWhaleLeaderboard(50);

    for (let i = 0; i < data.length; i++) {
      expect(data[i].rank).toBe(i + 1);
    }
  });
});
```

---

## References

- **Schema:** `docs/leaderboard-schema.md`
- **Metrics:** `docs/leaderboard-metrics.md`
- **Query Examples:** `docs/leaderboard-queries.md`
- **ClickHouse Client:** https://clickhouse.com/docs/en/integrations/language-clients/nodejs

---

## Support

For issues or questions:
- Check schema documentation for table structure
- Review query examples for common patterns
- Verify ClickHouse connection settings
- Check API route logs for errors
