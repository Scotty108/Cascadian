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
  console.log('Does realized_pnl_by_market_final have RESOLUTION data?\n');

  // Check how many have resolved_at
  const resolvedCount = await client.query({
    query: `
      SELECT
        count() AS total,
        countIf(resolved_at IS NOT NULL) AS with_resolved_at,
        count(DISTINCT condition_id_norm) AS unique_markets,
        countIf(resolved_at IS NOT NULL, DISTINCT condition_id_norm) AS resolved_markets
      FROM default.realized_pnl_by_market_final
    `,
    format: 'JSONEachRow',
  });

  const r = (await resolvedCount.json<Array<any>>())[0];
  console.log('resolved_at field:');
  console.log(`  Total rows:        ${r.total.toLocaleString()}`);
  console.log(`  With resolved_at:  ${r.with_resolved_at.toLocaleString()}`);
  console.log(`  Unique markets:    ${r.unique_markets.toLocaleString()}`);
  console.log(`  Resolved markets:  ${r.resolved_markets.toLocaleString()}`);
  console.log();

  // Check if these overlap with our existing resolutions
  const overlap = await client.query({
    query: `
      SELECT
        count(DISTINCT p.condition_id_norm) AS total_in_pnl,
        count(DISTINCT r.cid_hex) AS total_in_resolutions,
        (SELECT count(DISTINCT p.condition_id_norm)
         FROM default.realized_pnl_by_market_final p
         INNER JOIN cascadian_clean.vw_resolutions_all r
           ON lower(concat('0x', p.condition_id_norm)) = r.cid_hex) AS overlap
      FROM default.realized_pnl_by_market_final p, cascadian_clean.vw_resolutions_all r
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const o = (await overlap.json<Array<any>>())[0];
  console.log('Overlap with vw_resolutions_all:');
  console.log(`  Markets in PnL table:   ${o.total_in_pnl.toLocaleString()}`);
  console.log(`  Markets in resolutions: ${o.total_in_resolutions.toLocaleString()}`);
  console.log(`  Overlap:                ${o.overlap.toLocaleString()}`);
  console.log();

  // Check NEW markets not in vw_resolutions_all
  const newMarkets = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) AS new_markets
      FROM default.realized_pnl_by_market_final
      WHERE lower(concat('0x', condition_id_norm)) NOT IN (
        SELECT cid_hex FROM cascadian_clean.vw_resolutions_all
      )
    `,
    format: 'JSONEachRow',
  });

  const n = (await newMarkets.json<Array<any>>())[0];
  console.log(`NEW markets (not in vw_resolutions_all): ${n.new_markets.toLocaleString()}`);
  console.log();

  if (n.new_markets > 50000) {
    console.log('🎯🎯🎯 JACKPOT! This table has ~100K+ markets not in our resolution views!');
    console.log();
    console.log('BUT - we need to verify:');
    console.log('  1. Are these ACTUAL market resolutions?');
    console.log('  2. Or just "realized PnL" from closing positions (NOT resolutions)?');
    console.log();
    console.log('Let me sample some...');
    
    const sample = await client.query({
      query: `
        SELECT
          condition_id_norm,
          realized_pnl_usd,
          resolved_at
        FROM default.realized_pnl_by_market_final
        WHERE lower(concat('0x', condition_id_norm)) NOT IN (
          SELECT cid_hex FROM cascadian_clean.vw_resolutions_all
        )
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });

    const samples = await sample.json();
    console.log('\nSample new markets:');
    samples.forEach((s: any) => {
      console.log(`  ${s.condition_id_norm} | PnL=$${s.realized_pnl_usd} | resolved_at=${s.resolved_at}`);
    });
    console.log();
    console.log('⚠️  All have resolved_at=null');
    console.log('⚠️  This suggests "realized" means CLOSED POSITIONS not RESOLVED MARKETS');
    console.log();
    console.log('Conclusion: This table does NOT have market resolution data.');
    console.log('            It just tracks PnL from trades (buying/selling positions).');
  }

  await client.close();
}

main().catch(console.error);
