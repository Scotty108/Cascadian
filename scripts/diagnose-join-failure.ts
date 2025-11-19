#!/usr/bin/env tsx
/**
 * Diagnose Join Failure
 *
 * Critical Issue: 0 of 17,136 traded markets match ANY of 132,757 resolved markets
 * This script investigates why the LEFT JOIN is failing completely.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TEST_WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 DIAGNOSING JOIN FAILURE');
  console.log(`   Test wallet: ${TEST_WALLET}`);
  console.log('═'.repeat(80));

  // Step 1: Sample traded condition_ids
  console.log('\n📊 Step 1: Sampling wallet\'s traded condition_ids...\n');

  const tradedSample = await ch.query({
    query: `
      SELECT DISTINCT
        lower(replaceAll(cid, '0x', '')) as condition_id_norm,
        cid as original_cid,
        COUNT(*) as trade_count,
        length(lower(replaceAll(cid, '0x', ''))) as normalized_length
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      GROUP BY cid
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const traded = await tradedSample.json();
  console.log('  Top 10 traded markets (by trade count):');
  for (let i = 0; i < traded.length; i++) {
    const t = traded[i];
    const cid = t.condition_id_norm.substring(0, 16) + '...';
    console.log(`    ${i+1}. ${cid} (${t.trade_count} trades, len: ${t.normalized_length})`);
  }

  // Step 2: Sample resolved condition_ids from market_resolutions_final
  console.log('\n📊 Step 2: Sampling resolved markets from market_resolutions_final...\n');

  const resolvedSample1 = await ch.query({
    query: `
      SELECT DISTINCT
        condition_id_norm,
        length(condition_id_norm) as normalized_length,
        payout_denominator
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const resolved1 = await resolvedSample1.json();
  console.log('  Sample from market_resolutions_final:');
  for (let i = 0; i < resolved1.length; i++) {
    const r = resolved1[i];
    const cid = r.condition_id_norm.substring(0, 16) + '...';
    console.log(`    ${i+1}. ${cid} (len: ${r.normalized_length}, denom: ${r.payout_denominator})`);
  }

  // Step 3: Sample from resolutions_external_ingest
  console.log('\n📊 Step 3: Sampling from resolutions_external_ingest...\n');

  const resolvedSample2 = await ch.query({
    query: `
      SELECT DISTINCT
        condition_id,
        length(condition_id) as normalized_length,
        payout_denominator
      FROM default.resolutions_external_ingest
      WHERE payout_denominator > 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const resolved2 = await resolvedSample2.json();
  console.log('  Sample from resolutions_external_ingest:');
  for (let i = 0; i < resolved2.length; i++) {
    const r = resolved2[i];
    const cid = r.condition_id.substring(0, 16) + '...';
    console.log(`    ${i+1}. ${cid} (len: ${r.normalized_length}, denom: ${r.payout_denominator})`);
  }

  // Step 4: Check for ANY overlap with specific traded markets
  console.log('\n📊 Step 4: Testing for ANY overlap with specific traded markets...\n');

  const topTradedCid = traded[0].condition_id_norm;
  console.log(`  Testing if top traded market exists in resolution tables:`);
  console.log(`  CID: ${topTradedCid.substring(0, 32)}...`);

  const overlapTest1 = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.market_resolutions_final
      WHERE condition_id_norm = '${topTradedCid}'
        AND payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });

  const overlap1 = await overlapTest1.json();
  console.log(`\n  Found in market_resolutions_final: ${overlap1[0].count} matches`);

  const overlapTest2 = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.resolutions_external_ingest
      WHERE condition_id = '${topTradedCid}'
        AND payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });

  const overlap2 = await overlapTest2.json();
  console.log(`  Found in resolutions_external_ingest: ${overlap2[0].count} matches`);

  // Step 5: Global overlap statistics
  console.log('\n📊 Step 5: Global overlap statistics...\n');

  const globalOverlap = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      ),
      resolved_markets_union AS (
        SELECT DISTINCT condition_id_norm as condition_id
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION ALL

        SELECT DISTINCT condition_id
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        (SELECT COUNT(DISTINCT condition_id) FROM traded_markets) as total_traded,
        (SELECT COUNT(DISTINCT condition_id) FROM resolved_markets_union) as total_resolved,
        COUNT(DISTINCT tm.condition_id) as matched_count
      FROM traded_markets tm
      INNER JOIN resolved_markets_union rm ON tm.condition_id = rm.condition_id
    `,
    format: 'JSONEachRow',
  });

  const stats = await globalOverlap.json();
  const totalTraded = parseInt(stats[0].total_traded);
  const totalResolved = parseInt(stats[0].total_resolved);
  const matched = parseInt(stats[0].matched_count);
  const matchPct = (matched / totalTraded * 100).toFixed(2);

  console.log(`  Total traded markets (wallet): ${totalTraded.toLocaleString()}`);
  console.log(`  Total resolved markets (both tables): ${totalResolved.toLocaleString()}`);
  console.log(`  Matched markets: ${matched.toLocaleString()} (${matchPct}%)`);
  console.log(`  Unmatched markets: ${(totalTraded - matched).toLocaleString()} (${(100 - parseFloat(matchPct)).toFixed(2)}%)`);

  console.log('\n' + '═'.repeat(80));
  console.log('🔍 DIAGNOSIS COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
