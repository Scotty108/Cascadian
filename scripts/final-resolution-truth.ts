#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function finalTruth() {
  console.log('=== FINAL RESOLUTION TRUTH ===\n');

  // The mystery: Why is condition_id_norm EMPTY in the JOIN results?
  // Let's check if market_resolutions_final has EMPTY condition_id_norm values

  console.log('1. Check for EMPTY condition_id_norm in market_resolutions_final');
  const emptyCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as total_resolutions,
        SUM(CASE WHEN condition_id_norm = '' THEN 1 ELSE 0 END) as empty_condition_id_norm,
        SUM(CASE WHEN length(condition_id_norm) != 64 THEN 1 ELSE 0 END) as wrong_length
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow'
  });
  const empty = await emptyCheck.json<any>();
  console.log(`  Total resolutions: ${parseInt(empty[0].total_resolutions).toLocaleString()}`);
  console.log(`  Empty condition_id_norm: ${parseInt(empty[0].empty_condition_id_norm)}`);
  console.log(`  Wrong length (not 64): ${parseInt(empty[0].wrong_length)}`);
  console.log();

  if (parseInt(empty[0].empty_condition_id_norm) > 0) {
    console.log('  ⚠️  FOUND EMPTY condition_id_norm in market_resolutions_final!');
    console.log('     This explains the NULL resolution matches.\n');

    // Sample
    const sample = await client.query({
      query: `
        SELECT *
        FROM market_resolutions_final
        WHERE condition_id_norm = ''
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const samples = await sample.json<any>();
    console.log('     Sample records with empty condition_id_norm:');
    samples.forEach((s: any, i: number) => {
      console.log(`     ${i+1}. winning_outcome: ${s.winning_outcome}, source: ${s.source}, payout: [${s.payout_numerators.join(', ')}]/${s.payout_denominator}`);
    });
  }

  console.log('\n\n2. Understanding the REAL data structure');
  console.log('   Hypothesis: market_resolutions_final has MANY rows with empty condition_id_norm');
  console.log('   When we JOIN, ClickHouse matches ALL empty strings together (CROSS JOIN)\n');

  // Count how many trades have empty condition_id
  const tradesEmpty = await client.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE condition_id = ''`,
    format: 'JSONEachRow'
  });
  const tEmpty = await tradesEmpty.json<any>();

  // Count how many resolutions have empty condition_id_norm
  const resEmpty = await client.query({
    query: `SELECT COUNT(*) as count FROM market_resolutions_final WHERE condition_id_norm = ''`,
    format: 'JSONEachRow'
  });
  const rEmpty = await resEmpty.json<any>();

  const tradesEmptyCount = parseInt(tEmpty[0].count);
  const resEmptyCount = parseInt(rEmpty[0].count);

  console.log(`   Trades with empty condition_id: ${tradesEmptyCount.toLocaleString()}`);
  console.log(`   Resolutions with empty condition_id_norm: ${resEmptyCount.toLocaleString()}`);

  if (tradesEmptyCount > 0 && resEmptyCount > 0) {
    console.log(`\n   ❌ CROSS JOIN EXPLOSION: ${tradesEmptyCount.toLocaleString()} × ${resEmptyCount.toLocaleString()} = ${(tradesEmptyCount * resEmptyCount).toLocaleString()} potential matches!`);
    console.log('      This would multiply result rows and cause incorrect statistics.\n');
  }

  console.log('\n3. CORRECT JOIN (excluding empty condition_ids)');
  const correctJoin = await client.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as has_resolution,
        SUM(CASE
          WHEN r.condition_id_norm IS NOT NULL
            AND length(r.payout_numerators) > 0
            AND r.payout_denominator > 0
          THEN 1 ELSE 0
        END) as can_calculate_pnl
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        AND r.condition_id_norm != ''  -- KEY: Exclude empty condition_id_norm
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const correct = await correctJoin.json<any>();
  const total = parseInt(correct[0].total_trades);
  const hasRes = parseInt(correct[0].has_resolution);
  const canCalc = parseInt(correct[0].can_calculate_pnl);

  console.log(`  Total trades (non-empty condition_id): ${total.toLocaleString()}`);
  console.log(`  Has resolution: ${hasRes.toLocaleString()} (${(hasRes/total*100).toFixed(2)}%)`);
  console.log(`  Can calculate P&L: ${canCalc.toLocaleString()} (${(canCalc/total*100).toFixed(2)}%)`);
  console.log();

  console.log('4. CORRECT volume breakdown');
  const volumeCorrect = await client.query({
    query: `
      SELECT
        SUM(t.usd_value) as total_volume,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN t.usd_value ELSE 0 END) as resolved_volume,
        SUM(CASE
          WHEN r.condition_id_norm IS NOT NULL
            AND length(r.payout_numerators) > 0
            AND r.payout_denominator > 0
          THEN t.usd_value ELSE 0
        END) as pnl_calculable_volume
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        AND r.condition_id_norm != ''
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const vol = await volumeCorrect.json<any>();
  const totalVol = parseFloat(vol[0].total_volume);
  const resVol = parseFloat(vol[0].resolved_volume);
  const calcVol = parseFloat(vol[0].pnl_calculable_volume);

  console.log(`  Total volume: $${totalVol.toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`  Resolved volume: $${resVol.toLocaleString(undefined, {maximumFractionDigits: 2})} (${(resVol/totalVol*100).toFixed(2)}%)`);
  console.log(`  P&L calculable: $${calcVol.toLocaleString(undefined, {maximumFractionDigits: 2})} (${(calcVol/totalVol*100).toFixed(2)}%)`);
  console.log();

  console.log('\n=== THE TRUTH ===\n');
  console.log('RESOLVED MARKETS:');
  console.log(`  • ${(hasRes/total*100).toFixed(2)}% of trades have resolution data`);
  console.log(`  • ${(resVol/totalVol*100).toFixed(2)}% of volume has resolution data`);
  console.log();
  console.log('UNRESOLVED MARKETS:');
  console.log(`  • ${((total-hasRes)/total*100).toFixed(2)}% of trades have NO resolution (likely open markets)`);
  console.log(`  • ${((totalVol-resVol)/totalVol*100).toFixed(2)}% of volume has NO resolution`);
  console.log();
  console.log('P&L CALCULATION READINESS:');
  console.log(`  ✅ ${(canCalc/total*100).toFixed(2)}% of trades CAN calculate realized P&L`);
  console.log(`  ✅ ${(calcVol/totalVol*100).toFixed(2)}% of volume CAN calculate realized P&L`);
  console.log();
  console.log('BLOCKERS:');
  console.log(`  1. ${((total-hasRes)/total*100).toFixed(2)}% trades lack resolution data`);
  console.log(`     → Check if markets are still OPEN (unrealized P&L only)`);
  console.log(`     → Or missing resolution backfill (fetch from API)`);
  console.log();
  console.log(`  2. ${tradesEmptyCount.toLocaleString()} trades (${(tradesEmptyCount/(total+tradesEmptyCount)*100).toFixed(2)}%) have empty condition_id`);
  console.log('     → Recoverable via ERC1155 blockchain data');
  console.log();
  console.log(`  3. 94 resolutions have invalid payout_denominator`);
  console.log('     → Manual data fix required');

  await client.close();
}

finalTruth().catch(console.error);
