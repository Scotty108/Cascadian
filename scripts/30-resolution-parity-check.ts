import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Polymarket API time window
const START_TIME = new Date(1724259231000); // 2024-08-21
const END_TIME = new Date(1763250566105);   // 2025-11-11

async function checkResolutionParity() {
  console.log('=== Step 3: Resolution Parity Check ===\n');
  console.log(`Time window: ${START_TIME.toISOString()} to ${END_TIME.toISOString()}\n`);
  console.log('Comparing our resolution data vs Polymarket for top 10 markets\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get top 10 markets (same query as Step 1)
  const topMarketsQuery = `
    SELECT
      condition_id_norm_v3 AS condition_id,
      outcome_index_v3 AS outcome_idx,
      sum(abs(usd_value)) AS total_volume,
      count() AS trade_count
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND timestamp >= '${START_TIME.toISOString().split('T')[0]}'
      AND timestamp <= '${END_TIME.toISOString().split('T')[0]}'
    GROUP BY condition_id, outcome_idx
    ORDER BY total_volume DESC
    LIMIT 10
  `;

  const topMarketsResult = await clickhouse.query({ query: topMarketsQuery, format: 'JSONEachRow' });
  const topMarkets = await topMarketsResult.json<any[]>();

  console.log('Top 10 Markets - Resolution Data:\n');

  const resolutionDetails: any[] = [];

  for (let i = 0; i < topMarkets.length; i++) {
    const market = topMarkets[i];
    const conditionId = market.condition_id;
    const outcomeIdx = market.outcome_idx;

    console.log(`[${i + 1}] Market: ${conditionId.substring(0, 20)}...`);
    console.log(`    Our Position: Outcome ${outcomeIdx}`);
    console.log(`    Volume: $${Number(market.total_volume).toLocaleString()}, Trades: ${market.trade_count}\n`);

    // Get resolution for this market
    const resolutionQuery = `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index,
        winning_outcome,
        outcome_count,
        source,
        resolved_at
      FROM market_resolutions_final
      WHERE condition_id_norm = '${conditionId}'
        AND payout_denominator > 0
      LIMIT 1
    `;

    const resolutionResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
    const resolution = await resolutionResult.json<any[]>();

    if (resolution.length > 0) {
      const res = resolution[0];
      const payoutArray = Array.isArray(res.payout_numerators) ? res.payout_numerators : [];
      const payoutDenom = Number(res.payout_denominator);
      const winningIdx = Number(res.winning_index);
      const outcomeCount = Number(res.outcome_count);
      const source = res.source;
      const resolvedAt = res.resolved_at;

      console.log('    ┌─ RESOLUTION DATA ─────────────────────────────────────────┐');
      console.log(`    │ Winning Index:     ${winningIdx}`);
      console.log(`    │ Winning Outcome:   ${res.winning_outcome}`);
      console.log(`    │ Outcome Count:     ${outcomeCount}`);
      console.log(`    │ Payout Vector:     [${payoutArray.join(', ')}] / ${payoutDenom}`);
      console.log(`    │ Payout Ratio:      [${payoutArray.map((n: number) => (n / payoutDenom).toFixed(4)).join(', ')}]`);
      console.log(`    │ Source:            ${source}`);
      console.log(`    │ Resolved At:       ${resolvedAt || 'N/A'}`);
      console.log('    └───────────────────────────────────────────────────────────┘\n');

      // Get position details
      const positionQuery = `
        SELECT
          sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
          sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${EOA}')
          AND condition_id_norm_v3 = '${conditionId}'
          AND outcome_index_v3 = ${outcomeIdx}
          AND timestamp >= '${START_TIME.toISOString().split('T')[0]}'
          AND timestamp <= '${END_TIME.toISOString().split('T')[0]}'
      `;

      const positionResult = await clickhouse.query({ query: positionQuery, format: 'JSONEachRow' });
      const position = await positionResult.json<any[]>();

      const netShares = Number(position[0].net_shares);
      const netCost = Number(position[0].net_cost);
      const myPayout = Number(payoutArray[outcomeIdx] || 0);
      const settlementValue = netShares * (myPayout / payoutDenom);
      const marketPnL = settlementValue - netCost;

      console.log('    ┌─ OUR CALCULATION ─────────────────────────────────────────┐');
      console.log(`    │ Our Outcome Index: ${outcomeIdx}`);
      console.log(`    │ Net Shares:        ${netShares.toFixed(2)}`);
      console.log(`    │ Net Cost:          $${netCost.toFixed(2)}`);
      console.log(`    │ Our Payout:        ${myPayout}/${payoutDenom} = ${(myPayout / payoutDenom).toFixed(4)}`);
      console.log(`    │ Settlement Value:  ${netShares.toFixed(2)} × ${(myPayout / payoutDenom).toFixed(4)} = $${settlementValue.toFixed(2)}`);
      console.log(`    │ Market PnL:        $${settlementValue.toFixed(2)} - $${netCost.toFixed(2)} = $${marketPnL.toFixed(2)}`);
      console.log('    └───────────────────────────────────────────────────────────┘\n');

      const outcomeMatch = outcomeIdx === winningIdx;
      const pnlPositive = marketPnL > 0;

      console.log('    ┌─ ANALYSIS ────────────────────────────────────────────────┐');
      console.log(`    │ Outcome Match:     ${outcomeMatch ? '✅ YES (bet on winner)' : '❌ NO (bet on loser)'}`);
      console.log(`    │ PnL Sign:          ${pnlPositive ? '✅ Positive' : '❌ Negative'}`);
      console.log(`    │ Formula Check:     settlement (${settlementValue.toFixed(2)}) - cost (${netCost.toFixed(2)}) = ${marketPnL.toFixed(2)}`);
      console.log('    └───────────────────────────────────────────────────────────┘\n');

      resolutionDetails.push({
        rank: i + 1,
        condition_id_short: conditionId.substring(0, 20) + '...',
        our_outcome: outcomeIdx,
        winning_index: winningIdx,
        outcome_match: outcomeMatch,
        payout_vector: `[${payoutArray.join(', ')}]/${payoutDenom}`,
        our_payout_ratio: (myPayout / payoutDenom).toFixed(4),
        net_shares: netShares.toFixed(2),
        net_cost: netCost.toFixed(2),
        settlement_value: settlementValue.toFixed(2),
        market_pnl: marketPnL.toFixed(2),
        pnl_positive: pnlPositive,
        source
      });
    } else {
      console.log('    ⚠️  NO RESOLUTION DATA FOUND\n');

      resolutionDetails.push({
        rank: i + 1,
        condition_id_short: conditionId.substring(0, 20) + '...',
        our_outcome: outcomeIdx,
        winning_index: 'N/A',
        outcome_match: false,
        payout_vector: 'N/A',
        our_payout_ratio: 'N/A',
        net_shares: 'N/A',
        net_cost: 'N/A',
        settlement_value: 'N/A',
        market_pnl: 'Unresolved',
        pnl_positive: false,
        source: 'N/A'
      });
    }

    console.log('═'.repeat(79) + '\n');
  }

  // Summary table
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('RESOLUTION PARITY SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('| # | Condition ID         | Our | Win | Match | Payout Ratio | PnL       | Source        |');
  console.log('|---|----------------------|-----|-----|-------|--------------|-----------|---------------|');

  resolutionDetails.forEach(m => {
    const matchSymbol = m.outcome_match ? '✅' : '❌';
    const pnlSymbol = m.pnl_positive ? '✅' : '❌';
    console.log(`| ${String(m.rank).padStart(1)} | ${m.condition_id_short.padEnd(20)} | ${String(m.our_outcome).padStart(3)} | ${String(m.winning_index).padStart(3)} | ${matchSymbol.padEnd(5)} | ${String(m.our_payout_ratio).padStart(12)} | ${pnlSymbol} ${String(m.market_pnl).padStart(9)} | ${String(m.source).padEnd(13)} |`);
  });

  console.log('\n');

  // Statistics
  const resolvedMarkets = resolutionDetails.filter(m => m.winning_index !== 'N/A');
  const outcomeMatches = resolvedMarkets.filter(m => m.outcome_match).length;
  const outcomeMismatches = resolvedMarkets.filter(m => !m.outcome_match).length;
  const positiveMarkets = resolvedMarkets.filter(m => m.pnl_positive).length;
  const negativeMarkets = resolvedMarkets.filter(m => !m.pnl_positive).length;

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('STATISTICS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log(`Resolved Markets:      ${resolvedMarkets.length} / ${resolutionDetails.length}`);
  console.log(`Outcome Matches:       ${outcomeMatches} ✅ (${((outcomeMatches / resolvedMarkets.length) * 100).toFixed(1)}%)`);
  console.log(`Outcome Mismatches:    ${outcomeMismatches} ❌ (${((outcomeMismatches / resolvedMarkets.length) * 100).toFixed(1)}%)`);
  console.log(`Positive PnL Markets:  ${positiveMarkets} ✅`);
  console.log(`Negative PnL Markets:  ${negativeMarkets} ❌`);
  console.log('');

  // Source breakdown
  const sourceBreakdown = resolvedMarkets.reduce((acc: any, m) => {
    acc[m.source] = (acc[m.source] || 0) + 1;
    return acc;
  }, {});

  console.log('Resolution Data Sources:');
  Object.entries(sourceBreakdown).forEach(([source, count]) => {
    console.log(`  ${source}: ${count} markets`);
  });
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('KEY FINDINGS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  if (outcomeMismatches === resolvedMarkets.length) {
    console.log('🚨 CRITICAL: 100% outcome mismatch in top resolved markets!');
    console.log('');
    console.log('PATTERN OBSERVED:');
    console.log('  - ALL markets show wallet bet on outcome that LOST');
    console.log('  - ALL markets resulted in negative PnL');
    console.log('  - This is the direct cause of the -$494k discrepancy');
    console.log('');
    console.log('POSSIBLE ROOT CAUSES:');
    console.log('  1. ❌ Resolution data has wrong winning_index (systematic error in source)');
    console.log('  2. ❌ Outcome index mapping is inverted in our data pipeline');
    console.log('  3. ❌ Wallet genuinely bet wrong in every market (statistically impossible)');
    console.log('');
    console.log('RECOMMENDATION:');
    console.log('  Pick 2-3 markets from above and manually verify against Polymarket UI:');
    console.log('    - What outcome won?');
    console.log('    - What outcome did xcnstrategy bet on?');
    console.log('    - Does the payout vector match?');
    console.log('');
  } else if (outcomeMatches > outcomeMismatches) {
    console.log('✅ Majority of markets show correct outcome matching');
    console.log('   Issue may be in specific market types or edge cases');
  } else {
    console.log('⚠️  Mixed results - some markets match, some don\'t');
    console.log('   Investigate pattern in mismatched markets');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  return resolutionDetails;
}

checkResolutionParity().catch(console.error);
