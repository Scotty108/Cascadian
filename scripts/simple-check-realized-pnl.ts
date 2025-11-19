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
  console.log('FINAL ANSWER: Does realized_pnl_by_market_final have NEW resolutions?\n');

  // Simple check: how many NEW markets does it have?
  const newCount = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) AS new_markets
      FROM default.realized_pnl_by_market_final
      WHERE lower(concat('0x', condition_id_norm)) NOT IN (
        SELECT cid_hex FROM cascadian_clean.vw_resolutions_all
      )
    `,
    format: 'JSONEachRow',
  });

  const n = (await newCount.json<Array<any>>())[0];
  console.log(`NEW markets (not in vw_resolutions_all): ${n.new_markets.toLocaleString()}`);
  console.log();

  // Sample these new markets
  const sample = await client.query({
    query: `
      SELECT *
      FROM default.realized_pnl_by_market_final
      WHERE lower(concat('0x', condition_id_norm)) NOT IN (
        SELECT cid_hex FROM cascadian_clean.vw_resolutions_all
      )
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const samples = await sample.json();
  console.log('Sample of NEW markets:');
  samples.forEach((s: any) => {
    console.log(`  ${s.condition_id_norm.substring(0, 12)}... | PnL=$${s.realized_pnl_usd} | resolved_at=${s.resolved_at}`);
  });
  console.log();

  if (samples.every((s: any) => s.resolved_at === null)) {
    console.log('❌ VERDICT: ALL samples have resolved_at=null');
    console.log();
    console.log('This table does NOT have market resolution data.');
    console.log('"Realized PnL" here means PnL from CLOSED POSITIONS (buying then selling),');
    console.log('NOT from market resolutions.');
    console.log();
    console.log('This is NOT useful for our goal.');
  } else {
    console.log('✅ SOME have resolved_at dates - need to investigate further!');
  }

  await client.close();
}

main().catch(console.error);
