#!/usr/bin/env tsx
/**
 * Final Coverage Gap Analysis
 *
 * After enhanced binary mapping (59% coverage), analyze the remaining 41% gap:
 * - Where are these markets?
 * - What data sources cover them?
 * - Are they old/delisted/cancelled?
 * - What's the path to close the gap?
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

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('📊 FINAL COVERAGE GAP ANALYSIS');
  console.log('   Understanding the remaining 41% gap after all backfill efforts');
  console.log('═'.repeat(80));

  // Step 1: Overall coverage stats
  console.log('\n📊 Step 1: Current Coverage State...\n');

  const overallStats = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      )
      SELECT
        COUNT(*) as total_traded_markets,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout,
        SUM(CASE WHEN r.payout_denominator IS NULL THEN 1 ELSE 0 END) as missing_payout
      FROM traded_markets tm
      LEFT JOIN all_resolutions r
        ON tm.condition_id = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const overall = await overallStats.json();
  const totalTraded = parseInt(overall[0].total_traded_markets);
  const hasPayout = parseInt(overall[0].has_payout);
  const missingPayout = parseInt(overall[0].missing_payout);
  const coveragePct = (hasPayout / totalTraded * 100).toFixed(1);

  console.log(`  Total traded markets: ${totalTraded.toLocaleString()}`);
  console.log(`  Has payout vector: ${hasPayout.toLocaleString()} (${coveragePct}%)`);
  console.log(`  Missing payout: ${missingPayout.toLocaleString()} (${(100 - parseFloat(coveragePct)).toFixed(1)}%)`);

  // Step 2: Break down by data source
  console.log('\n📊 Step 2: Coverage by Data Source...\n');

  const sourceBreakdown = await ch.query({
    query: `
      WITH all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      )
      SELECT
        source,
        COUNT(*) as market_count,
        SUM(CASE WHEN payout_denominator > 0 THEN 1 ELSE 0 END) as valid_payouts
      FROM all_resolutions
      GROUP BY source
      ORDER BY market_count DESC
    `,
    format: 'JSONEachRow',
  });

  const sources = await sourceBreakdown.json();
  console.log(`  Source breakdown:`);
  for (const s of sources) {
    console.log(`    ${s.source}: ${parseInt(s.market_count).toLocaleString()} markets (${parseInt(s.valid_payouts).toLocaleString()} valid)`);
  }

  // Step 3: Check if missing markets exist in api_markets_staging
  console.log('\n📊 Step 3: Are missing markets in api_markets_staging?...\n');

  const stagingCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id
        FROM default.resolutions_external_ingest
      ),
      missing_payouts AS (
        SELECT tm.condition_id
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE r.condition_id_norm IS NULL
      )
      SELECT
        COUNT(*) as missing_count,
        SUM(CASE WHEN ams.condition_id IS NOT NULL THEN 1 ELSE 0 END) as in_staging,
        SUM(CASE WHEN ams.condition_id IS NOT NULL AND length(ams.outcomes) > 0 THEN 1 ELSE 0 END) as has_outcomes,
        SUM(CASE WHEN ams.condition_id IS NOT NULL AND ams.closed = 1 THEN 1 ELSE 0 END) as is_closed
      FROM missing_payouts mp
      LEFT JOIN default.api_markets_staging ams
        ON mp.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
    `,
    format: 'JSONEachRow',
  });

  const staging = await stagingCheck.json();
  const missingCount = parseInt(staging[0].missing_count);
  const inStaging = parseInt(staging[0].in_staging);
  const hasOutcomes = parseInt(staging[0].has_outcomes);
  const isClosed = parseInt(staging[0].is_closed);

  console.log(`  Missing markets: ${missingCount.toLocaleString()}`);
  console.log(`  Found in api_markets_staging: ${inStaging.toLocaleString()} (${(inStaging/missingCount*100).toFixed(1)}%)`);
  console.log(`  Has outcome arrays: ${hasOutcomes.toLocaleString()} (${(hasOutcomes/missingCount*100).toFixed(1)}%)`);
  console.log(`  Marked as closed: ${isClosed.toLocaleString()} (${(isClosed/missingCount*100).toFixed(1)}%)`);

  // Step 4: Sample missing markets to understand patterns
  console.log('\n📊 Step 4: Sampling missing markets for patterns...\n');

  const sampleMissing = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id
        FROM default.resolutions_external_ingest
      ),
      missing_payouts AS (
        SELECT tm.condition_id
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE r.condition_id_norm IS NULL
      )
      SELECT
        mp.condition_id,
        ams.question,
        ams.outcomes,
        ams.closed,
        ams.end_date,
        rc.outcome as text_outcome,
        rc.confidence
      FROM missing_payouts mp
      LEFT JOIN default.api_markets_staging ams
        ON mp.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
      LEFT JOIN default.resolution_candidates rc
        ON mp.condition_id = rc.condition_id_norm
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const samples = await sampleMissing.json();
  console.log(`  Sample of ${samples.length} missing markets:\n`);

  for (let i = 0; i < Math.min(10, samples.length); i++) {
    const s = samples[i];
    const cid = s.condition_id ? s.condition_id.substring(0, 16) + '...' : 'N/A';
    const question = s.question ? s.question.substring(0, 50) + '...' : 'NO METADATA';
    const outcomes = s.outcomes ? `[${s.outcomes.join(', ')}]` : 'NO OUTCOMES';
    const textOutcome = s.text_outcome || 'N/A';
    const closed = s.closed ? 'CLOSED' : 'OPEN';

    console.log(`  ${i+1}. ${cid}`);
    console.log(`     Q: ${question}`);
    console.log(`     Outcomes: ${outcomes}`);
    console.log(`     Text outcome: ${textOutcome} (conf: ${s.confidence || 'N/A'})`);
    console.log(`     Status: ${closed}`);
    console.log();
  }

  // Step 5: Check trade volume distribution
  console.log('\n📊 Step 5: Trade volume for missing vs covered markets...\n');

  const volumeCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as condition_id,
          COUNT(*) as trade_count,
          SUM(ABS(usdc_amount)) as total_volume
        FROM default.fact_trades_clean
        GROUP BY condition_id
      ),
      all_resolutions AS (
        SELECT condition_id_norm
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id
        FROM default.resolutions_external_ingest
      )
      SELECT
        CASE WHEN r.condition_id_norm IS NOT NULL THEN 'Has Payout' ELSE 'Missing Payout' END as status,
        COUNT(*) as market_count,
        SUM(tm.trade_count) as total_trades,
        SUM(tm.total_volume) as total_volume_usdc,
        AVG(tm.trade_count) as avg_trades_per_market,
        AVG(tm.total_volume) as avg_volume_per_market
      FROM traded_markets tm
      LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
      GROUP BY status
    `,
    format: 'JSONEachRow',
  });

  const volume = await volumeCheck.json();
  console.log(`  Volume distribution:\n`);
  for (const v of volume) {
    const status = v.status;
    const markets = parseInt(v.market_count).toLocaleString();
    const trades = parseInt(v.total_trades).toLocaleString();
    const volumeUsd = parseFloat(v.total_volume_usdc).toLocaleString(undefined, {maximumFractionDigits: 0});
    const avgTrades = parseFloat(v.avg_trades_per_market).toFixed(1);
    const avgVolume = parseFloat(v.avg_volume_per_market).toFixed(0);

    console.log(`  ${status}:`);
    console.log(`    Markets: ${markets}`);
    console.log(`    Total trades: ${trades}`);
    console.log(`    Total volume: $${volumeUsd}`);
    console.log(`    Avg trades/market: ${avgTrades}`);
    console.log(`    Avg volume/market: $${avgVolume}`);
    console.log();
  }

  // Step 6: Time distribution of missing markets
  console.log('\n📊 Step 6: Time distribution of missing markets...\n');

  const timeCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as condition_id,
          MIN(block_timestamp) as first_trade_time
        FROM default.fact_trades_clean
        GROUP BY condition_id
      ),
      all_resolutions AS (
        SELECT condition_id_norm
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id
        FROM default.resolutions_external_ingest
      ),
      missing_payouts AS (
        SELECT tm.condition_id, tm.first_trade_time
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE r.condition_id_norm IS NULL
      )
      SELECT
        toStartOfMonth(first_trade_time) as month,
        COUNT(*) as missing_count
      FROM missing_payouts
      GROUP BY month
      ORDER BY month DESC
      LIMIT 24
    `,
    format: 'JSONEachRow',
  });

  const timeData = await timeCheck.json();
  console.log(`  Missing markets by month (last 24 months):\n`);
  for (const t of timeData) {
    const month = t.month;
    const count = parseInt(t.missing_count).toLocaleString();
    const bar = '█'.repeat(Math.min(50, Math.floor(parseInt(t.missing_count) / 500)));
    console.log(`  ${month}: ${count.padStart(6)} ${bar}`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('📊 ANALYSIS COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
