#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = process.env.WALLET || '0x7f3c8979d0afa00007bae4747d5347122af05613';
const MODE = process.argv.includes('--per-market') ? 'per-market' :
             process.argv.includes('--ui-metrics') ? 'ui-metrics' : 'summary';

// Ground truth from Polymarket UI
const POLYMARKET_VOLUME = 5_083_626.69;
const POLYMARKET_GAIN = 376_597.39;
const POLYMARKET_LOSS = 190_734.84;
const POLYMARKET_NET = 184_862.55;

async function perMarketAnalysis() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PER-MARKET P&L BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const result = await clickhouse.query({
    query: `
      WITH trades_by_position AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          count() AS fill_count,
          sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
          shares_buy - shares_sell AS net_shares,
          sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
          sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
          sum(toFloat64(usd_value)) AS volume
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_idx
      ),
      with_resolutions AS (
        SELECT
          t.*,
          r.winning_outcome,
          r.resolved_at,
          if(t.outcome_idx = 0, 'NO', if(t.outcome_idx = 1, 'YES', toString(t.outcome_idx))) AS outcome_str,
          if(
            r.payout_denominator = 0
              OR r.payout_denominator IS NULL
              OR length(r.payout_numerators) < t.outcome_idx + 1,
            0,
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
          ) AS payout_per_share,
          t.net_shares * payout_per_share AS settlement_value,
          t.proceeds_sell - t.cost_buy AS trading_pnl,
          (t.net_shares * payout_per_share) + t.proceeds_sell - t.cost_buy AS total_pnl,
          trim(outcome_str) = trim(r.winning_outcome) AS is_winning_outcome
        FROM trades_by_position t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
      ),
      per_market AS (
        SELECT
          cid,
          count() AS positions,
          sum(fill_count) AS fills,
          sum(volume) AS market_volume,
          sum(trading_pnl) AS market_trading_pnl,
          sum(settlement_value) AS market_settlement,
          sum(total_pnl) AS market_total_pnl,
          any(winning_outcome) AS resolution_status,
          countIf(is_winning_outcome) AS positions_on_winner
        FROM with_resolutions
        GROUP BY cid
      )
      SELECT
        cid,
        positions,
        fills,
        market_volume,
        market_trading_pnl,
        market_settlement,
        market_total_pnl,
        resolution_status
      FROM per_market
      ORDER BY abs(market_total_pnl) DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const markets = await result.json<Array<any>>();

  console.log('Top 50 Markets by |P&L|:');
  console.log('─'.repeat(130));
  console.log('Condition ID             | Pos | Fills | Volume      | Trading P&L  | Settlement | Total P&L    | Resolved');
  console.log('─'.repeat(130));

  let totalVolume = 0;
  let totalTradingPnl = 0;
  let totalSettlement = 0;
  let totalPnl = 0;

  markets.forEach((m) => {
    const vol = parseFloat(m.market_volume);
    const tradePnl = parseFloat(m.market_trading_pnl);
    const settlement = parseFloat(m.market_settlement);
    const mktPnl = parseFloat(m.market_total_pnl);
    const resolved = m.resolution_status ? '✓' : '✗';

    totalVolume += vol;
    totalTradingPnl += tradePnl;
    totalSettlement += settlement;
    totalPnl += mktPnl;

    const cidShort = m.cid.substring(0, 16) + '...';
    console.log(
      `${cidShort.padEnd(24)} | ${String(m.positions).padStart(3)} | ${String(m.fills).padStart(5)} | ` +
      `$${vol.toFixed(2).padStart(10)} | $${tradePnl.toFixed(2).padStart(11)} | ` +
      `$${settlement.toFixed(2).padStart(9)} | $${mktPnl.toFixed(2).padStart(11)} | ${resolved}`
    );
  });

  console.log('─'.repeat(130));
  console.log(`TOTAL (top 50): Volume=$${totalVolume.toFixed(2)} | Trade P&L=$${totalTradingPnl.toFixed(2)} | Settlement=$${totalSettlement.toFixed(2)} | Total=$${totalPnl.toFixed(2)}`);
  console.log('');

  // Summary stats
  const withResolution = markets.filter(m => m.resolution_status).length;
  const withoutResolution = markets.filter(m => !m.resolution_status).length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ANALYSIS:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Markets with resolution data: ${withResolution}`);
  console.log(`Markets missing resolution:   ${withoutResolution}`);
  console.log('');
  console.log('💡 Look for markets with huge trading P&L but $0 settlement.');
  console.log('   These are likely fully-exited positions inflating gains.');
}

async function uiMetricsAnalysis() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('UI-ALIGNED METRICS (Polymarket-style calculation)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const result = await clickhouse.query({
    query: `
      WITH trades_by_position AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
          shares_buy - shares_sell AS net_shares,
          sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
          sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
          sum(toFloat64(usd_value)) AS volume
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_idx
      ),
      with_resolutions AS (
        SELECT
          t.*,
          r.winning_outcome,
          r.resolved_at,
          if(t.outcome_idx = 0, 'NO', if(t.outcome_idx = 1, 'YES', toString(t.outcome_idx))) AS outcome_str,
          if(
            r.payout_denominator = 0
              OR r.payout_denominator IS NULL
              OR length(r.payout_numerators) < t.outcome_idx + 1,
            0,
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
          ) AS payout_per_share,
          (t.net_shares * payout_per_share) + t.proceeds_sell - t.cost_buy AS position_pnl,
          trim(outcome_str) = trim(r.winning_outcome) AS is_winning_outcome
        FROM trades_by_position t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
        WHERE r.winning_outcome IS NOT NULL  -- Only markets with resolution data
          AND r.winning_outcome != ''         -- Exclude empty resolutions
          AND abs(t.net_shares) > 1e-6        -- Dust filter
      ),
      per_market AS (
        SELECT
          cid,
          sum(position_pnl) AS market_pnl,
          sum(volume) AS market_volume
        FROM with_resolutions
        GROUP BY cid
      )
      SELECT
        -- Volume
        sum(market_volume) AS total_volume,

        -- P&L breakdown
        sumIf(market_pnl, market_pnl > 0) AS gain,
        -sumIf(market_pnl, market_pnl < 0) AS loss,
        sum(market_pnl) AS net_total,

        -- Counts
        count() AS total_markets,
        countIf(market_pnl > 0) AS winning_markets,
        countIf(market_pnl < 0) AS losing_markets
      FROM per_market
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  const volume = parseFloat(r.total_volume);
  const gain = parseFloat(r.gain);
  const loss = parseFloat(r.loss);
  const net = parseFloat(r.net_total);

  console.log('FILTER APPLIED:');
  console.log('  ✓ Only markets with resolution data');
  console.log('  ✓ Only non-empty winning_outcome');
  console.log('  ✓ Dust filter: |net_shares| > 1e-6');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('OUR CALCULATION:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Volume:        $${volume.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Gain:          $${gain.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Loss:          $${loss.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Net total:     $${net.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log('');
  console.log(`  Markets:       ${parseInt(r.total_markets)}`);
  console.log(`  Winning:       ${parseInt(r.winning_markets)}`);
  console.log(`  Losing:        ${parseInt(r.losing_markets)}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POLYMARKET UI (GROUND TRUTH):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Volume:        $${POLYMARKET_VOLUME.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Gain:          $${POLYMARKET_GAIN.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Loss:          $${POLYMARKET_LOSS.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Net total:     $${POLYMARKET_NET.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON:');
  console.log('═══════════════════════════════════════════════════════════════');

  const volumeDiff = volume - POLYMARKET_VOLUME;
  const gainDiff = gain - POLYMARKET_GAIN;
  const lossDiff = loss - POLYMARKET_LOSS;
  const netDiff = net - POLYMARKET_NET;

  const volumeRatio = volume / POLYMARKET_VOLUME;
  const gainRatio = gain / POLYMARKET_GAIN;
  const lossRatio = loss / POLYMARKET_LOSS;
  const netRatio = net / POLYMARKET_NET;

  console.log(`  Volume:   ${volume > POLYMARKET_VOLUME ? '+' : ''}$${volumeDiff.toFixed(2)} (${volumeRatio.toFixed(2)}x) ${Math.abs(volumeDiff) < 1000 ? '✅' : '❌'}`);
  console.log(`  Gain:     ${gain > POLYMARKET_GAIN ? '+' : ''}$${gainDiff.toFixed(2)} (${gainRatio.toFixed(2)}x) ${Math.abs(gainDiff) < 1000 ? '✅' : '❌'}`);
  console.log(`  Loss:     ${loss > POLYMARKET_LOSS ? '+' : ''}$${lossDiff.toFixed(2)} (${lossRatio.toFixed(2)}x) ${Math.abs(lossDiff) < 1000 ? '✅' : '❌'}`);
  console.log(`  Net:      ${net > POLYMARKET_NET ? '+' : ''}$${netDiff.toFixed(2)} (${netRatio.toFixed(2)}x) ${Math.abs(netDiff) < 1000 ? '✅' : '❌'}`);
  console.log('');

  if (Math.abs(netDiff) > 1000) {
    console.log('💡 NEXT STEPS:');
    if (gainRatio > 2) {
      console.log('   Gains still too high - likely counting trading P&L multiple times');
      console.log('   per market. Need average-cost or FIFO inventory tracking.');
    }
    if (volumeRatio > 1.1) {
      console.log('   Volume too high - may be counting fills Polymarket excludes');
      console.log('   (self-trades, cancels, or special fill types).');
    }
    console.log('   Run --per-market to see which markets inflate P&L.');
  }
}

async function summaryAnalysis() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('WALLET P&L INVESTIGATION');
  console.log(`Wallet: ${WALLET}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const result = await clickhouse.query({
    query: `
      WITH trades_by_position AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          count() AS fills,
          sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
          shares_buy - shares_sell AS net_shares,
          sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
          sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
          sum(toFloat64(usd_value)) AS volume
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_idx
      ),
      with_resolutions AS (
        SELECT
          t.*,
          r.winning_outcome,
          if(
            r.payout_denominator = 0
              OR r.payout_denominator IS NULL
              OR length(r.payout_numerators) < t.outcome_idx + 1,
            0,
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
          ) AS payout_per_share,
          (t.net_shares * payout_per_share) + t.proceeds_sell - t.cost_buy AS position_pnl
        FROM trades_by_position t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
      )
      SELECT
        -- Totals
        count() AS total_positions,
        sum(fills) AS total_fills,
        sum(volume) AS total_volume,

        -- Resolution coverage
        countIf(winning_outcome IS NOT NULL AND winning_outcome != '') AS positions_with_resolution,
        countIf(winning_outcome IS NULL OR winning_outcome = '') AS positions_missing_resolution,

        -- P&L
        sumIf(position_pnl, position_pnl > 0) AS total_gains,
        -sumIf(position_pnl, position_pnl < 0) AS total_losses,
        sum(position_pnl) AS net_pnl
      FROM with_resolutions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('DATA SUMMARY:');
  console.log(`  Total Positions:     ${parseInt(r.total_positions)}`);
  console.log(`  Total Fills:         ${parseInt(r.total_fills)}`);
  console.log(`  Total Volume:        $${parseFloat(r.total_volume).toLocaleString()}`);
  console.log('');
  console.log(`  With Resolution:     ${parseInt(r.positions_with_resolution)} (${((parseInt(r.positions_with_resolution) / parseInt(r.total_positions)) * 100).toFixed(1)}%)`);
  console.log(`  Missing Resolution:  ${parseInt(r.positions_missing_resolution)} (${((parseInt(r.positions_missing_resolution) / parseInt(r.total_positions)) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('OUR P&L (ALL POSITIONS):');
  console.log(`  Gains:  $${parseFloat(r.total_gains).toLocaleString()}`);
  console.log(`  Losses: $${parseFloat(r.total_losses).toLocaleString()}`);
  console.log(`  Net:    $${parseFloat(r.net_pnl).toLocaleString()}`);
  console.log('');

  console.log('POLYMARKET UI (GROUND TRUTH):');
  console.log(`  Volume: $${POLYMARKET_VOLUME.toLocaleString()}`);
  console.log(`  Gain:   $${POLYMARKET_GAIN.toLocaleString()}`);
  console.log(`  Loss:   $${POLYMARKET_LOSS.toLocaleString()}`);
  console.log(`  Net:    $${POLYMARKET_NET.toLocaleString()}`);
  console.log('');

  console.log('DISCREPANCY:');
  const netDiff = parseFloat(r.net_pnl) - POLYMARKET_NET;
  const netRatio = parseFloat(r.net_pnl) / POLYMARKET_NET;
  console.log(`  Our Net - PM Net: $${netDiff.toFixed(2)} (${netRatio.toFixed(2)}x)`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MODES AVAILABLE:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  --per-market    : Show top 50 markets by |P&L| to identify');
  console.log('                    which markets inflate gains');
  console.log('');
  console.log('  --ui-metrics    : Apply Polymarket-style filters (resolution');
  console.log('                    data required, dust filter, etc.)');
  console.log('');
  console.log('Run: npx tsx scripts/98-wallet-pnl-investigation.ts --per-market');
  console.log('Or:  npx tsx scripts/98-wallet-pnl-investigation.ts --ui-metrics');
}

async function main() {
  if (MODE === 'per-market') {
    await perMarketAnalysis();
  } else if (MODE === 'ui-metrics') {
    await uiMetricsAnalysis();
  } else {
    await summaryAnalysis();
  }
}

main().catch(console.error);
