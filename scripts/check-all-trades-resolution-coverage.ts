#!/usr/bin/env npx tsx
/**
 * Check resolution coverage across ALL trades in trades_raw
 * Compare unique condition IDs vs resolution coverage
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('RESOLUTION COVERAGE ACROSS ALL TRADES');
  console.log('═'.repeat(100) + '\n');

  try {
    // Query 1: Unique condition IDs coverage
    console.log('1️⃣  Unique Condition ID Coverage:');
    const result1 = await ch.query({
      query: `
        SELECT
          countDistinct(lower(substring(t.condition_id, 3, 64))) AS total_condition_ids,
          countDistinctIf(lower(substring(t.condition_id, 3, 64)), res.condition_id_norm IS NOT NULL) AS condition_ids_with_resolution,
          countDistinctIf(lower(substring(t.condition_id, 3, 64)), res.condition_id_norm IS NULL) AS condition_ids_without_resolution,
          round((countDistinctIf(lower(substring(t.condition_id, 3, 64)), res.condition_id_norm IS NOT NULL) / countDistinct(lower(substring(t.condition_id, 3, 64)))) * 100, 2) AS pct_coverage
        FROM default.trades_raw t
        LEFT JOIN default.market_resolutions_final res
          ON lower(substring(t.condition_id, 3, 64)) = res.condition_id_norm
      `,
      format: 'JSONEachRow'
    });
    const data1 = await result1.json<any[]>();
    if (data1.length > 0) {
      const row = data1[0];
      console.log(`   Total unique condition IDs: ${row.total_condition_ids.toLocaleString()}`);
      console.log(`   With resolution: ${row.condition_ids_with_resolution.toLocaleString()}`);
      console.log(`   Without resolution: ${row.condition_ids_without_resolution.toLocaleString()}`);
      console.log(`   Coverage: ${row.pct_coverage}%\n`);
    }

    // Query 2: Trade count coverage
    console.log('2️⃣  Trade Count Coverage:');
    const result2 = await ch.query({
      query: `
        SELECT
          count() AS total_trades,
          countIf(res.condition_id_norm IS NOT NULL) AS trades_with_resolution,
          countIf(res.condition_id_norm IS NULL) AS trades_without_resolution,
          round((countIf(res.condition_id_norm IS NOT NULL) / count()) * 100, 2) AS pct_coverage
        FROM default.trades_raw t
        LEFT JOIN default.market_resolutions_final res
          ON lower(substring(t.condition_id, 3, 64)) = res.condition_id_norm
      `,
      format: 'JSONEachRow'
    });
    const data2 = await result2.json<any[]>();
    if (data2.length > 0) {
      const row = data2[0];
      console.log(`   Total trades: ${row.total_trades.toLocaleString()}`);
      console.log(`   With resolution: ${row.trades_with_resolution.toLocaleString()}`);
      console.log(`   Without resolution: ${row.trades_without_resolution.toLocaleString()}`);
      console.log(`   Coverage: ${row.pct_coverage}%\n`);
    }

    // Query 3: Break down by resolution status
    console.log('3️⃣  Markets by Resolution Status:');
    const result3 = await ch.query({
      query: `
        SELECT
          CASE
            WHEN res.condition_id_norm IS NOT NULL THEN 'RESOLVED'
            ELSE 'UNRESOLVED'
          END AS status,
          countDistinct(lower(substring(t.condition_id, 3, 64))) AS unique_markets,
          count() AS trade_count
        FROM default.trades_raw t
        LEFT JOIN default.market_resolutions_final res
          ON lower(substring(t.condition_id, 3, 64)) = res.condition_id_norm
        GROUP BY status
        ORDER BY status DESC
      `,
      format: 'JSONEachRow'
    });
    const data3 = await result3.json<any[]>();
    for (const row of data3) {
      console.log(`   ${row.status}: ${row.unique_markets.toLocaleString()} markets, ${row.trade_count.toLocaleString()} trades`);
    }

    console.log('\n' + '═'.repeat(100));
    console.log('KEY INSIGHT');
    console.log('═'.repeat(100));
    if (data2.length > 0 && data2[0].pct_coverage > 80) {
      console.log('✅ HIGH COVERAGE: >80% of all trades have matched resolutions');
      console.log('   You can build leaderboards and P&L calculations with high confidence');
    } else if (data2.length > 0 && data2[0].pct_coverage > 60) {
      console.log('⚠️  MODERATE COVERAGE: 60-80% of trades have resolutions');
      console.log('   Consider improving coverage before shipping');
    } else {
      console.log('❌ LOW COVERAGE: <60% of trades have resolutions');
      console.log('   Major gaps exist—backfill or other fixes needed');
    }
    console.log('');

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
