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
  console.log('\n🔍 INSPECTING vw_wallet_pnl_calculated\n');
  console.log('═'.repeat(80));

  // Get view definition
  const viewDef = await ch.query({
    query: "SHOW CREATE TABLE default.vw_wallet_pnl_calculated",
    format: 'JSONEachRow'
  });

  const def = await viewDef.json();
  console.log('\n1️⃣ View Definition:\n');
  console.log(def[0].statement);
  console.log('\n');

  // Check sample positions
  console.log('2️⃣ Sample Position Analysis:\n');

  const sample = await ch.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        payout_denominator,
        realized_pnl,
        unrealized_pnl
      FROM default.vw_wallet_pnl_calculated
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const sampleData = await sample.json();
  console.log('Sample positions:');
  for (const row of sampleData) {
    console.log('  CID: ' + row.condition_id.substring(0, 16) + '...');
    console.log('  Payout denom: ' + row.payout_denominator);
    console.log('  Realized: ' + row.realized_pnl);
    console.log('  Unrealized: ' + row.unrealized_pnl);
    console.log('');
  }

  // Check distribution
  console.log('3️⃣ Resolution Distribution:\n');

  const dist = await ch.query({
    query: `
      SELECT
        payout_denominator > 0 as has_resolution,
        COUNT(*) as count,
        ROUND(100.0 * count / SUM(count) OVER (), 2) as pct
      FROM default.vw_wallet_pnl_calculated
      GROUP BY has_resolution
    `,
    format: 'JSONEachRow'
  });

  const distData = await dist.json();
  for (const row of distData) {
    console.log('  ' + (row.has_resolution ? 'Resolved' : 'Unresolved') + ': ' + 
      parseInt(row.count).toLocaleString() + ' (' + row.pct + '%)');
  }

  console.log('\n═'.repeat(80) + '\n');

  await ch.close();
}

main();
