#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  // Check pm_canonical_fills_v4 schema
  console.log('=== pm_canonical_fills_v4 schema ===');
  const schema = await clickhouse.query({
    query: `DESCRIBE pm_canonical_fills_v4`,
    format: 'JSONEachRow'
  });
  const rows = await schema.json() as any[];
  rows.forEach(r => console.log(`${r.name}: ${r.type}`));

  // Sample data
  console.log('\n=== Sample fills (5 rows) ===');
  const sample = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        event_time,
        tokens_delta,
        usdc_delta,
        is_maker,
        source
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 7 DAY
        AND source = 'clob'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const data = await sample.json() as any[];
  data.forEach(r => console.log(JSON.stringify(r)));

  // Count recent data
  console.log('\n=== Data counts (last 90d) ===');
  const counts = await clickhouse.query({
    query: `
      SELECT
        count() as total_fills,
        countIf(tokens_delta > 0) as buys,
        countIf(tokens_delta < 0) as sells,
        count(DISTINCT wallet) as unique_wallets,
        count(DISTINCT condition_id) as unique_markets
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 90 DAY
        AND source = 'clob'
    `,
    format: 'JSONEachRow'
  });
  const c = (await counts.json() as any[])[0];
  console.log(`Total fills: ${Number(c.total_fills).toLocaleString()}`);
  console.log(`Buys: ${Number(c.buys).toLocaleString()}`);
  console.log(`Sells: ${Number(c.sells).toLocaleString()}`);
  console.log(`Unique wallets: ${Number(c.unique_wallets).toLocaleString()}`);
  console.log(`Unique markets: ${Number(c.unique_markets).toLocaleString()}`);
}
main().catch(console.error);
