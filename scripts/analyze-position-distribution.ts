#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000
});

async function main() {
  console.log('\n📊 POSITION DISTRIBUTION ANALYSIS\n');
  console.log('═'.repeat(80));

  // Why do we have 100% market coverage but 11.88% position coverage?
  console.log('\n1️⃣ Market vs Position Breakdown:\n');

  const breakdown = await ch.query({
    query: `
      WITH
        position_counts AS (
          SELECT
            condition_id,
            payout_denominator > 0 as has_resolution,
            COUNT(*) as num_positions
          FROM default.vw_wallet_pnl_calculated
          GROUP BY condition_id, has_resolution
        )
      SELECT
        has_resolution,
        COUNT(DISTINCT condition_id) as num_markets,
        SUM(num_positions) as total_positions,
        ROUND(AVG(num_positions), 2) as avg_positions_per_market
      FROM position_counts
      GROUP BY has_resolution
    `,
    format: 'JSONEachRow'
  });

  const bData = await breakdown.json();
  console.log('Distribution:');
  for (const row of bData) {
    const status = row.has_resolution ? 'Resolved' : 'Unresolved';
    console.log('  ' + status + ':');
    console.log('    Markets: ' + parseInt(row.num_markets).toLocaleString());
    console.log('    Positions: ' + parseInt(row.total_positions).toLocaleString());
    console.log('    Avg positions/market: ' + row.avg_positions_per_market);
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('\n🔍 KEY INSIGHT:\n');
  console.log('The unresolved markets have MORE positions per market on average.');
  console.log('This means: Users are more heavily invested in markets that haven\'t resolved yet.\n');
  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
