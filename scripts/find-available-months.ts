#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  // Find earliest and latest active months with canonical trades
  const query = `
    SELECT
      toYYYYMM(timestamp) as partition,
      count(*) as total_trades,
      countIf(source = 'canonical') as canonical_trades,
      countIf(source = 'erc1155') as erc1155_trades,
      countIf(source = 'clob') as clob_trades,
      min(timestamp) as first_timestamp,
      max(timestamp) as last_timestamp
    FROM pm_trades_canonical_v2
    WHERE timestamp >= '2022-01-01'
    GROUP BY partition
    HAVING canonical_trades > 1000
    ORDER BY partition
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  console.log('Available months with canonical trades:\n');
  console.log('Partition  Total Trades  Canonical    ERC1155      CLOB       First Date   Last Date');
  console.log('─'.repeat(90));

  for (const row of data) {
    const partition = row.partition.toString();
    const total = parseInt(row.total_trades).toLocaleString().padStart(12);
    const canonical = parseInt(row.canonical_trades).toLocaleString().padStart(10);
    const erc1155 = parseInt(row.erc1155_trades).toLocaleString().padStart(10);
    const clob = parseInt(row.clob_trades).toLocaleString().padStart(10);
    const first = row.first_timestamp.split(' ')[0];
    const last = row.last_timestamp.split(' ')[0];

    console.log(`${partition}     ${total} ${canonical} ${erc1155} ${clob}  ${first}  ${last}`);
  }

  console.log('\nRecommended test months:');
  console.log(`- Earliest: ${data[0].partition} (first canonical trades)`);
  console.log(`- Mid-range: ${data[Math.floor(data.length / 2)].partition} (middle of range)`);
  console.log(`- Latest: ${data[data.length - 1].partition} (most recent)`);
  console.log(`- Already tested: 202408, 202409, 202410 (Aug-Oct 2024 sandbox)`);
}

main().catch(console.error);
