#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  // Get schema
  const schemaResult = await ch.query({
    query: 'DESCRIBE TABLE default.trades_raw',
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json<any[]>();

  console.log('\n=== TRADES_RAW SCHEMA ===\n');
  schema.forEach(col => {
    console.log(`${col.name.padEnd(30)} ${col.type}`);
  });

  // Get sample negative cashflows
  const sampleResult = await ch.query({
    query: `
      SELECT
        wallet,
        condition_id,
        cashflow_usdc,
        shares,
        price,
        side,
        outcome
      FROM default.trades_raw
      WHERE wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      ORDER BY toFloat64(cashflow_usdc) ASC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json<any[]>();

  console.log('\n=== SAMPLE TRADES (sorted by cashflow) ===\n');
  samples.forEach(s => {
    console.log(`Cashflow: ${parseFloat(s.cashflow_usdc).toFixed(2).padStart(12)} | Side: ${s.side || 'null'} | Shares: ${s.shares} | Price: ${s.price}`);
  });

  await ch.close();
}

main().catch(console.error);
