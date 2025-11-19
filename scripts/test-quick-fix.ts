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
  console.log('Testing quick fix: NULL for unresolved positions\n');

  // Check one test wallet
  const result = await client.query({
    query: `
      SELECT
        wallet_remapped AS wallet,
        countIf(is_resolved) AS resolved,
        countIf(NOT is_resolved) AS unresolved,
        sumIf(realized_pnl_usd, is_resolved) AS resolved_pnl,
        sumIf(realized_pnl_usd, NOT is_resolved) AS unresolved_pnl
      FROM cascadian_clean.vw_wallet_positions
      WHERE wallet_remapped = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'
      GROUP BY wallet_remapped
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<Array<{
    wallet: string;
    resolved: number;
    unresolved: number;
    resolved_pnl: number | null;
    unresolved_pnl: number | null;
  }>>();

  if (data.length > 0) {
    const d = data[0];
    console.log('Test Wallet: 0x1489...');
    console.log(`  Resolved positions:   ${d.resolved}`);
    console.log(`  Unresolved positions: ${d.unresolved}`);
    console.log(`  Resolved PnL:         ${d.resolved_pnl !== null ? '$' + Math.round(d.resolved_pnl).toLocaleString() : 'NULL'}`);
    console.log(`  Unresolved PnL:       ${d.unresolved_pnl !== null ? '$' + Math.round(d.unresolved_pnl).toLocaleString() : 'NULL (CORRECT!)'}`);
    console.log();

    if (d.unresolved_pnl === null || d.unresolved_pnl === 0) {
      console.log('✅ Quick fix worked! Unresolved positions show NULL instead of negative PnL');
    } else {
      console.log('❌ Quick fix failed - unresolved still showing non-zero PnL');
    }
  } else {
    console.log('❌ No data found for test wallet');
  }

  await client.close();
}

main().catch(console.error);
