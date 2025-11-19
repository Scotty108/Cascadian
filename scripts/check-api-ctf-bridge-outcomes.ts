#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('Analyzing api_ctf_bridge outcomes...\n');

  // Get outcome distribution
  const outcomes = await client.query({
    query: `
      SELECT
        resolved_outcome,
        count() AS cnt,
        count(DISTINCT condition_id) AS unique_markets
      FROM default.api_ctf_bridge
      WHERE resolved_outcome IS NOT NULL
      GROUP BY resolved_outcome
      ORDER BY cnt DESC
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });

  const rows = await outcomes.json<Array<{ resolved_outcome: string; cnt: number; unique_markets: number }>>();
  console.log('Outcome Distribution:');
  console.log('─'.repeat(80));
  rows.forEach(r => {
    console.log(`  ${r.resolved_outcome.padEnd(20)} ${r.cnt.toLocaleString().padStart(10)} rows, ${r.unique_markets.toLocaleString().padStart(8)} markets`);
  });

  console.log();
  console.log('Total outcomes:', rows.length);

  // Check if we have binary (Yes/No) vs multi-outcome
  const binaryCount = rows.filter(r => ['Yes', 'No'].includes(r.resolved_outcome)).reduce((sum, r) => sum + r.unique_markets, 0);
  const totalCount = rows.reduce((sum, r) => sum + r.unique_markets, 0);

  console.log();
  console.log(`Binary markets (Yes/No): ${binaryCount.toLocaleString()} (${(100 * binaryCount / totalCount).toFixed(1)}%)`);
  console.log(`Total markets: ${totalCount.toLocaleString()}`);

  await client.close();
}

main().catch(console.error);
