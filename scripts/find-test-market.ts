#!/usr/bin/env tsx
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT
        m.market_id,
        e.canonical_category as category,
        m.question,
        count(DISTINCT t.wallet_address) as num_traders
      FROM trades_raw t
      JOIN markets_dim m ON t.market_id = m.market_id
      JOIN events_dim e ON m.event_id = e.event_id
      WHERE e.canonical_category = 'Politics / Geopolitics'
        AND t.is_resolved = 0
        AND t.timestamp >= now() - INTERVAL 30 DAY
      GROUP BY m.market_id, e.canonical_category, m.question
      HAVING num_traders >= 20
      ORDER BY num_traders DESC
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json();
  console.log('Markets with 20+ traders:');
  rows.forEach((row: any, i: number) => {
    console.log(`\n${i + 1}. ${row.question}`);
    console.log(`   Market ID: ${row.market_id}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Traders: ${row.num_traders}`);
  });
}

main().catch(console.error);
