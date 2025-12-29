#!/usr/bin/env npx tsx
/**
 * FINAL TRUTH: P&L Coverage Analysis
 *
 * ONE QUERY to answer: "Can we calculate accurate P&L for all wallets?"
 *
 * Checks:
 * 1. Total positions (by count and volume)
 * 2. How many have midprices (for unrealized P&L)
 * 3. How many have resolutions (for redemption P&L)
 * 4. Overall P&L calculation readiness
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('FINAL TRUTH: P&L COVERAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Count all positions
  console.log('Step 1: Counting all open positions...\n');

  const allPositions = await ch.query({
    query: `
      WITH pos AS (
        SELECT
          lower(wallet_address_norm) AS wallet,
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
          sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND outcome_index >= 0
        GROUP BY wallet, market_cid, outcome
        HAVING abs(shares_net) >= 0.01
      )
      SELECT
        count(*) as total_positions,
        count(DISTINCT market_cid) as unique_markets,
        sum(abs(shares_net * (-cash_net / nullIf(shares_net, 0)))) as total_position_value_usd
      FROM pos
    `,
    format: 'JSONEachRow',
  });

  const allPos = await allPositions.json<any[]>();
  console.log(`Total Positions:        ${parseInt(allPos[0].total_positions).toLocaleString()}`);
  console.log(`Unique Markets:         ${parseInt(allPos[0].unique_markets).toLocaleString()}`);
  console.log(`Total Position Value:   $${parseFloat(allPos[0].total_position_value_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  // Step 2: Check midprice coverage
  console.log('Step 2: Checking midprice coverage...\n');

  const midpriceCoverage = await ch.query({
    query: `
      WITH pos AS (
        SELECT
          lower(wallet_address_norm) AS wallet,
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
          sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND outcome_index >= 0
        GROUP BY wallet, market_cid, outcome
        HAVING abs(shares_net) >= 0.01
      )
      SELECT
        count(*) as total,
        countIf(m.midprice IS NOT NULL) as with_midprice,
        sumIf(abs(shares_net * (-cash_net / nullIf(shares_net, 0))), m.midprice IS NOT NULL) as value_with_midprice,
        sum(abs(shares_net * (-cash_net / nullIf(shares_net, 0)))) as total_value
      FROM pos p
      LEFT JOIN cascadian_clean.midprices_latest m
        ON p.market_cid = m.market_cid AND p.outcome = m.outcome
    `,
    format: 'JSONEachRow',
  });

  const midCov = await midpriceCoverage.json<any[]>();
  const midPct = (parseInt(midCov[0].with_midprice) / parseInt(midCov[0].total) * 100).toFixed(2);
  const midVolPct = (parseFloat(midCov[0].value_with_midprice || 0) / parseFloat(midCov[0].total_value) * 100).toFixed(2);

  console.log(`Positions with midprices:   ${parseInt(midCov[0].with_midprice).toLocaleString()} / ${parseInt(midCov[0].total).toLocaleString()} (${midPct}%)`);
  console.log(`Value with midprices:       $${parseFloat(midCov[0].value_with_midprice || 0).toLocaleString()} / $${parseFloat(midCov[0].total_value).toLocaleString()} (${midVolPct}%)\n`);

  // Step 3: Check resolution coverage
  console.log('Step 3: Checking resolution coverage...\n');

  const resolutionCoverage = await ch.query({
    query: `
      WITH pos AS (
        SELECT
          lower(wallet_address_norm) AS wallet,
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
          sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND outcome_index >= 0
        GROUP BY wallet, market_cid, outcome
        HAVING abs(shares_net) >= 0.01
      )
      SELECT
        count(*) as total,
        countIf(r.cid_hex IS NOT NULL) as with_resolution,
        sumIf(abs(shares_net * (-cash_net / nullIf(shares_net, 0))), r.cid_hex IS NOT NULL) as value_with_resolution,
        sum(abs(shares_net * (-cash_net / nullIf(shares_net, 0)))) as total_value
      FROM pos p
      LEFT JOIN cascadian_clean.vw_resolutions_unified r
        ON lower(replaceAll(p.market_cid, '0x', '')) = lower(replaceAll(r.cid_hex, '0x', ''))
        AND r.payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });

  const resCov = await resolutionCoverage.json<any[]>();
  const resPct = (parseInt(resCov[0].with_resolution) / parseInt(resCov[0].total) * 100).toFixed(2);
  const resVolPct = (parseFloat(resCov[0].value_with_resolution || 0) / parseFloat(resCov[0].total_value) * 100).toFixed(2);

  console.log(`Positions with resolutions: ${parseInt(resCov[0].with_resolution).toLocaleString()} / ${parseInt(resCov[0].total).toLocaleString()} (${resPct}%)`);
  console.log(`Value with resolutions:     $${parseFloat(resCov[0].value_with_resolution || 0).toLocaleString()} / $${parseFloat(resCov[0].total_value).toLocaleString()} (${resVolPct}%)\n`);

  // Step 4: Combined coverage (either midprice OR resolution)
  console.log('Step 4: Calculating combined P&L coverage (midprice OR resolution)...\n');

  const combinedCoverage = await ch.query({
    query: `
      WITH pos AS (
        SELECT
          lower(wallet_address_norm) AS wallet,
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
          sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND outcome_index >= 0
        GROUP BY wallet, market_cid, outcome
        HAVING abs(shares_net) >= 0.01
      )
      SELECT
        count(*) as total,
        countIf(m.midprice IS NOT NULL OR r.cid_hex IS NOT NULL) as with_either,
        sumIf(abs(shares_net * (-cash_net / nullIf(shares_net, 0))), m.midprice IS NOT NULL OR r.cid_hex IS NOT NULL) as value_with_either,
        sum(abs(shares_net * (-cash_net / nullIf(shares_net, 0)))) as total_value
      FROM pos p
      LEFT JOIN cascadian_clean.midprices_latest m
        ON p.market_cid = m.market_cid AND p.outcome = m.outcome
      LEFT JOIN cascadian_clean.vw_resolutions_unified r
        ON lower(replaceAll(p.market_cid, '0x', '')) = lower(replaceAll(r.cid_hex, '0x', ''))
        AND r.payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });

  const combCov = await combinedCoverage.json<any[]>();
  const combPct = (parseInt(combCov[0].with_either) / parseInt(combCov[0].total) * 100).toFixed(2);
  const combVolPct = (parseFloat(combCov[0].value_with_either || 0) / parseFloat(combCov[0].total_value) * 100).toFixed(2);

  console.log(`Positions with P&L data:    ${parseInt(combCov[0].with_either).toLocaleString()} / ${parseInt(combCov[0].total).toLocaleString()} (${combPct}%)`);
  console.log(`Value with P&L data:        $${parseFloat(combCov[0].value_with_either || 0).toLocaleString()} / $${parseFloat(combCov[0].total_value).toLocaleString()} (${combVolPct}%)\n`);

  // Final verdict
  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Can we calculate P&L for ANY wallet?`);
  console.log('');

  if (parseFloat(combVolPct) >= 95) {
    console.log(`✅ YES - We have ${combVolPct}% volume coverage`);
    console.log(`   This is sufficient for production`);
  } else if (parseFloat(combVolPct) >= 75) {
    console.log(`⚠️  PARTIAL - We have ${combVolPct}% volume coverage`);
    console.log(`   This may be acceptable with documented limitations`);
  } else {
    console.log(`❌ NO - We only have ${combVolPct}% volume coverage`);
    console.log(`   This is NOT sufficient for accurate wallet P&L`);
  }

  console.log('');
  console.log('Breakdown:');
  console.log(`  - Midprice coverage:   ${midVolPct}% by value`);
  console.log(`  - Resolution coverage: ${resVolPct}% by value`);
  console.log(`  - Combined coverage:   ${combVolPct}% by value`);
  console.log('');

  await ch.close();
}

main().catch(console.error);
