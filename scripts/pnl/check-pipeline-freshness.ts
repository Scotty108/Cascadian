/**
 * Check pipeline freshness and missing tx
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const txHash = '7aca8715d8f28e1c2fe5ea6ecb653e994c1733d6944353d16a39095fb1185374';

  console.log('='.repeat(80));
  console.log('PIPELINE FRESHNESS CHECK');
  console.log('='.repeat(80));

  // Check pm_trader_events_v2 (raw) for the exact tx hash
  console.log('\n--- Searching for recent tx in pm_trader_events_v2 ---');
  const q1 = `
    SELECT count() as cnt
    FROM pm_trader_events_v2
    WHERE lower(hex(transaction_hash)) = lower('${txHash}')
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const data1 = (await r1.json()) as any[];
  console.log('  Matches for 0x' + txHash.slice(0, 16) + '...:', data1[0]?.cnt);

  // Check when the last insert was
  console.log('\n--- Latest data in each table ---');
  const tables = [
    { name: 'pm_trader_events_v2', timeCol: 'trade_time' },
    { name: 'pm_trader_events_dedup_v2_tbl', timeCol: 'trade_time' },
    { name: 'pm_fpmm_trades', timeCol: 'trade_time' },
    { name: 'pm_erc1155_transfers', timeCol: 'block_timestamp' },
    { name: 'pm_ctf_flows_inferred', timeCol: 'block_time' },
  ];

  for (const t of tables) {
    try {
      const q = `SELECT max(${t.timeCol}) as latest FROM ${t.name}`;
      const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
      const data = (await r.json()) as any[];
      console.log(`  ${t.name}: ${data[0]?.latest}`);
    } catch (e: any) {
      console.log(`  ${t.name}: error - ${e.message.slice(0, 50)}`);
    }
  }

  console.log('\n--- CONCLUSION ---');
  console.log('If pm_trader_events_v2 is stale, the Goldsky pipeline may need restart.');
  console.log('If its fresh but specific tx are missing, check subgraph indexing.');
}

main().catch(console.error);
