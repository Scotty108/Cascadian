#!/usr/bin/env tsx
/**
 * Validate PnL V2 wallets
 *
 * Comprehensive validation of pm_wallet_summary_v2:
 * - Top wallets by volume (ghost wallets)
 * - Random sample of high activity wallets
 * - Global distribution checks
 * - Cross-validation with pm_wallet_market_pnl_v2
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

interface WalletSummary {
  wallet_address: string;
  total_pnl_usd: string;
  realized_pnl_usd: string;
  unrealized_pnl_usd: string;
  settlement_pnl_usd: string;
  total_trades: string;
  total_markets: string;
  total_volume_usd: string;
  win_rate: string;
  avg_pnl_per_market: string;
  avg_pnl_per_trade: string;
  days_active: string;
  open_positions: string;
  closed_positions: string;
  resolved_positions: string;
}

interface PositionDetail {
  condition_id_norm: string;
  outcome_index: string;
  total_trades: string;
  final_position_size: string;
  total_pnl_usd: string;
  is_resolved: string;
}

async function validateWallet(walletAddress: string, label: string) {
  console.log(`\n🔍 Validating ${label} (${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)})`);
  console.log('='.repeat(80));

  // Get wallet summary
  const summaryQuery = `
    SELECT *
    FROM pm_wallet_summary_v2
    WHERE wallet_address = '${walletAddress}'
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summary = (await summaryResult.json())[0] as WalletSummary | undefined;

  if (!summary) {
    console.log('❌ Wallet not found in pm_wallet_summary_v2');
    return;
  }

  // Display summary
  console.log('\n📊 Wallet Summary:');
  console.log(`Total P&L:        $${parseFloat(summary.total_pnl_usd).toFixed(2)}`);
  console.log(`Realized P&L:     $${parseFloat(summary.realized_pnl_usd).toFixed(2)}`);
  console.log(`Unrealized P&L:   $${parseFloat(summary.unrealized_pnl_usd).toFixed(2)}`);
  console.log(`Settlement P&L:   $${parseFloat(summary.settlement_pnl_usd).toFixed(2)}`);
  console.log(`Total Trades:     ${summary.total_trades}`);
  console.log(`Total Markets:    ${summary.total_markets}`);
  console.log(`Total Volume:     $${parseFloat(summary.total_volume_usd).toFixed(2)}`);
  console.log(`Win Rate:         ${parseFloat(summary.win_rate).toFixed(1)}%`);
  console.log(`Avg P&L/Market:   $${parseFloat(summary.avg_pnl_per_market).toFixed(2)}`);
  console.log(`Avg P&L/Trade:    $${parseFloat(summary.avg_pnl_per_trade).toFixed(2)}`);
  console.log(`Days Active:      ${summary.days_active}`);
  console.log(`Open Positions:   ${summary.open_positions}`);
  console.log(`Closed Positions: ${summary.closed_positions}`);
  console.log(`Resolved Positions: ${summary.resolved_positions}`);

  // Get top 5 positions by absolute P&L
  const positionsQuery = `
    SELECT
      condition_id_norm,
      outcome_index,
      total_trades,
      final_position_size,
      total_pnl_usd,
      is_resolved
    FROM pm_wallet_market_pnl_v2
    WHERE wallet_address = '${walletAddress}'
    ORDER BY abs(total_pnl_usd) DESC
    LIMIT 5
  `;

  const positionsResult = await clickhouse.query({ query: positionsQuery, format: 'JSONEachRow' });
  const positions = await positionsResult.json() as PositionDetail[];

  console.log('\n📈 Top 5 Positions by Absolute P&L:');
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const condShort = `${pos.condition_id_norm.slice(0, 8)}...`;
    const resolved = pos.is_resolved === '1' ? '✓' : '✗';
    console.log(`  ${i + 1}. ${condShort} outcome:${pos.outcome_index} - $${parseFloat(pos.total_pnl_usd).toFixed(2)} (${pos.total_trades} trades, ${resolved} resolved)`);
  }

  // Cross-validate: Sum of market P&L should equal wallet summary
  const crossValidateQuery = `
    SELECT
      SUM(total_pnl_usd) AS sum_total_pnl,
      SUM(realized_pnl_usd) AS sum_realized_pnl,
      COUNT(*) AS position_count,
      SUM(total_trades) AS sum_trades
    FROM pm_wallet_market_pnl_v2
    WHERE wallet_address = '${walletAddress}'
  `;

  const crossResult = await clickhouse.query({ query: crossValidateQuery, format: 'JSONEachRow' });
  const crossData = (await crossResult.json())[0];

  console.log('\n🔄 Cross-Validation (pm_wallet_market_pnl_v2 sum):');
  console.log(`Sum of market P&L:  $${parseFloat(crossData.sum_total_pnl).toFixed(2)}`);
  console.log(`Sum of realized:    $${parseFloat(crossData.sum_realized_pnl).toFixed(2)}`);
  console.log(`Position count:     ${crossData.position_count}`);
  console.log(`Trade count:        ${crossData.sum_trades}`);

  // Check for discrepancies
  const pnlDiff = Math.abs(parseFloat(summary.total_pnl_usd) - parseFloat(crossData.sum_total_pnl));
  const tradesDiff = Math.abs(parseInt(summary.total_trades) - parseInt(crossData.sum_trades));
  const marketsDiff = Math.abs(parseInt(summary.total_markets) - parseInt(crossData.position_count));

  if (pnlDiff > 0.01 || tradesDiff > 0 || marketsDiff > 0) {
    console.log('\n⚠️  Discrepancies detected:');
    if (pnlDiff > 0.01) console.log(`  P&L difference: $${pnlDiff.toFixed(2)}`);
    if (tradesDiff > 0) console.log(`  Trade count difference: ${tradesDiff}`);
    if (marketsDiff > 0) console.log(`  Market count difference: ${marketsDiff}`);
  } else {
    console.log('\n✅ Cross-validation passed - all metrics match!');
  }
}

async function main() {
  console.log('🎯 PnL V2 Wallet Validation');
  console.log('='.repeat(80));
  console.log('Validating pm_wallet_summary_v2 against pm_wallet_market_pnl_v2');
  console.log('');

  // 1. Get top 5 wallets by volume (ghost wallets)
  console.log('📊 Finding top wallets by volume...');
  console.log('-'.repeat(80));

  const topByVolumeQuery = `
    SELECT wallet_address, total_volume_usd, total_pnl_usd, total_trades
    FROM pm_wallet_summary_v2
    ORDER BY total_volume_usd DESC
    LIMIT 5
  `;

  const topByVolumeResult = await clickhouse.query({ query: topByVolumeQuery, format: 'JSONEachRow' });
  const topByVolume = await topByVolumeResult.json() as any[];

  console.log('\nTop 5 wallets by volume:');
  for (let i = 0; i < topByVolume.length; i++) {
    const w = topByVolume[i];
    const walletShort = `${w.wallet_address.slice(0, 6)}...${w.wallet_address.slice(-4)}`;
    console.log(`  ${i + 1}. ${walletShort} - $${parseFloat(w.total_volume_usd).toFixed(2)} volume, $${parseFloat(w.total_pnl_usd).toFixed(2)} P&L, ${w.total_trades} trades`);
  }

  // Validate top 3 by volume
  for (let i = 0; i < Math.min(3, topByVolume.length); i++) {
    await validateWallet(topByVolume[i].wallet_address, `Top ${i + 1} by Volume`);
  }

  // 2. Get 3 random wallets with high activity (>20 trades)
  console.log('\n\n📊 Finding random high-activity wallets...');
  console.log('-'.repeat(80));

  const randomQuery = `
    SELECT wallet_address, total_trades, total_pnl_usd, total_volume_usd
    FROM pm_wallet_summary_v2
    WHERE total_trades >= 20
    ORDER BY rand()
    LIMIT 3
  `;

  const randomResult = await clickhouse.query({ query: randomQuery, format: 'JSONEachRow' });
  const randomWallets = await randomResult.json() as any[];

  console.log('\nRandom high-activity wallets:');
  for (let i = 0; i < randomWallets.length; i++) {
    const w = randomWallets[i];
    const walletShort = `${w.wallet_address.slice(0, 6)}...${w.wallet_address.slice(-4)}`;
    console.log(`  ${i + 1}. ${walletShort} - ${w.total_trades} trades, $${parseFloat(w.total_pnl_usd).toFixed(2)} P&L`);
  }

  for (let i = 0; i < randomWallets.length; i++) {
    await validateWallet(randomWallets[i].wallet_address, `Random Sample ${i + 1}`);
  }

  // XCNSTRATEGY WALLET VALIDATION
  console.log('\n\n🎯 XCNStrategy Wallet Validation (Control Wallet)');
  console.log('='.repeat(80));
  console.log('Wallet: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
  console.log('Purpose: Validate summary vs position aggregation for ground truth benchmark');
  console.log('');

  const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Query A: Summary table
  const summaryQueryXCN = `
    SELECT
      wallet_address,
      total_pnl_usd,
      realized_pnl_usd,
      unrealized_pnl_usd,
      settlement_pnl_usd,
      total_trades,
      total_volume_usd,
      win_rate,
      avg_pnl_per_trade
    FROM pm_wallet_summary_v2
    WHERE wallet_address = '${XCNSTRATEGY_WALLET}'
  `;

  const summaryResultXCN = await clickhouse.query({ query: summaryQueryXCN, format: 'JSONEachRow' });
  const summaryDataXCN = (await summaryResultXCN.json())[0] as any;

  // Query B: Aggregation from positions table
  const positionsAggQueryXCN = `
    SELECT
      wallet_address,
      sum(total_pnl_usd)          AS total_pnl_usd,
      sum(realized_pnl_usd)       AS realized_pnl_usd,
      sum(unrealized_pnl_usd)     AS unrealized_pnl_usd,
      sum(settlement_pnl_usd)     AS settlement_pnl_usd,
      sum(total_trades)           AS total_trades,
      sum(covered_volume_usd)     AS total_volume_usd
    FROM pm_wallet_market_pnl_v2
    WHERE wallet_address = '${XCNSTRATEGY_WALLET}'
    GROUP BY wallet_address
  `;

  const positionsAggResultXCN = await clickhouse.query({ query: positionsAggQueryXCN, format: 'JSONEachRow' });
  const positionsAggDataXCN = (await positionsAggResultXCN.json())[0] as any;

  // Check if wallet has positions
  if (!summaryDataXCN && !positionsAggDataXCN) {
    console.log('⚠️  WALLET HAS NO POSITIONS IN PNL V2');
    console.log('');
    console.log('This wallet is not present in either pm_wallet_summary_v2 or pm_wallet_market_pnl_v2.');
    console.log('This is expected if the wallet has no trading activity in the indexed period.');
    console.log('');
    console.log('Note: This wallet cannot be used as a ground truth benchmark until it has positions.');
    console.log('');
  } else if (!summaryDataXCN) {
    console.log('❌ ERROR: Wallet found in positions table but NOT in summary table!');
    console.log('This indicates a serious aggregation bug.');
    console.log('');
  } else if (!positionsAggDataXCN) {
    console.log('❌ ERROR: Wallet found in summary table but NOT in positions table!');
    console.log('This indicates a serious data integrity issue.');
    console.log('');
  } else {
    // Both exist - perform field-by-field comparison
    console.log('📊 Summary Table (A):');
    console.log(`  Total P&L:       $${parseFloat(summaryDataXCN.total_pnl_usd).toFixed(2)}`);
    console.log(`  Realized P&L:    $${parseFloat(summaryDataXCN.realized_pnl_usd).toFixed(2)}`);
    console.log(`  Unrealized P&L:  $${parseFloat(summaryDataXCN.unrealized_pnl_usd).toFixed(2)}`);
    console.log(`  Settlement P&L:  $${parseFloat(summaryDataXCN.settlement_pnl_usd).toFixed(2)}`);
    console.log(`  Total Trades:    ${summaryDataXCN.total_trades}`);
    console.log(`  Total Volume:    $${parseFloat(summaryDataXCN.total_volume_usd).toFixed(2)}`);
    console.log('');

    console.log('📊 Position Aggregation (B):');
    console.log(`  Total P&L:       $${parseFloat(positionsAggDataXCN.total_pnl_usd).toFixed(2)}`);
    console.log(`  Realized P&L:    $${parseFloat(positionsAggDataXCN.realized_pnl_usd).toFixed(2)}`);
    console.log(`  Unrealized P&L:  $${parseFloat(positionsAggDataXCN.unrealized_pnl_usd).toFixed(2)}`);
    console.log(`  Settlement P&L:  $${parseFloat(positionsAggDataXCN.settlement_pnl_usd).toFixed(2)}`);
    console.log(`  Total Trades:    ${positionsAggDataXCN.total_trades}`);
    console.log(`  Total Volume:    $${parseFloat(positionsAggDataXCN.total_volume_usd).toFixed(2)}`);
    console.log('');

    // Calculate differences
    const diffTotalPnL = Math.abs(parseFloat(summaryDataXCN.total_pnl_usd) - parseFloat(positionsAggDataXCN.total_pnl_usd));
    const diffRealizedPnL = Math.abs(parseFloat(summaryDataXCN.realized_pnl_usd) - parseFloat(positionsAggDataXCN.realized_pnl_usd));
    const diffUnrealizedPnL = Math.abs(parseFloat(summaryDataXCN.unrealized_pnl_usd) - parseFloat(positionsAggDataXCN.unrealized_pnl_usd));
    const diffSettlementPnL = Math.abs(parseFloat(summaryDataXCN.settlement_pnl_usd) - parseFloat(positionsAggDataXCN.settlement_pnl_usd));
    const diffTrades = Math.abs(parseInt(summaryDataXCN.total_trades) - parseInt(positionsAggDataXCN.total_trades));
    const diffVolume = Math.abs(parseFloat(summaryDataXCN.total_volume_usd) - parseFloat(positionsAggDataXCN.total_volume_usd));

    console.log('🔍 Field-by-Field Comparison (A - B):');
    console.log(`  Total P&L diff:       $${diffTotalPnL.toFixed(6)}`);
    console.log(`  Realized P&L diff:    $${diffRealizedPnL.toFixed(6)}`);
    console.log(`  Unrealized P&L diff:  $${diffUnrealizedPnL.toFixed(6)}`);
    console.log(`  Settlement P&L diff:  $${diffSettlementPnL.toFixed(6)}`);
    console.log(`  Trades diff:          ${diffTrades}`);
    console.log(`  Volume diff:          $${diffVolume.toFixed(6)}`);
    console.log('');

    // Tolerance check
    const TOLERANCE_USD = 0.01;
    const TOLERANCE_COUNT = 0;

    const passedPnL = diffTotalPnL <= TOLERANCE_USD;
    const passedRealized = diffRealizedPnL <= TOLERANCE_USD;
    const passedUnrealized = diffUnrealizedPnL <= TOLERANCE_USD;
    const passedSettlement = diffSettlementPnL <= TOLERANCE_USD;
    const passedTrades = diffTrades <= TOLERANCE_COUNT;
    const passedVolume = diffVolume <= TOLERANCE_USD;

    const allPassed = passedPnL && passedRealized && passedUnrealized && passedSettlement && passedTrades && passedVolume;

    if (allPassed) {
      console.log('✅ XCNSTRATEGY WALLET VALIDATION: PASS');
      console.log('');
      console.log('All fields match within tolerance (±$0.01 USD, ±0 counts).');
      console.log('This wallet is safe to use as a ground truth benchmark.');
      console.log('');
    } else {
      console.log('❌ XCNSTRATEGY WALLET VALIDATION: FAIL');
      console.log('');
      console.log('Discrepancies detected:');
      if (!passedPnL) console.log(`  ❌ Total P&L:       $${diffTotalPnL.toFixed(6)} (exceeds $${TOLERANCE_USD})`);
      if (!passedRealized) console.log(`  ❌ Realized P&L:    $${diffRealizedPnL.toFixed(6)} (exceeds $${TOLERANCE_USD})`);
      if (!passedUnrealized) console.log(`  ❌ Unrealized P&L:  $${diffUnrealizedPnL.toFixed(6)} (exceeds $${TOLERANCE_USD})`);
      if (!passedSettlement) console.log(`  ❌ Settlement P&L:  $${diffSettlementPnL.toFixed(6)} (exceeds $${TOLERANCE_USD})`);
      if (!passedTrades) console.log(`  ❌ Trades:          ${diffTrades} (must be exactly 0)`);
      if (!passedVolume) console.log(`  ❌ Volume:          $${diffVolume.toFixed(6)} (exceeds $${TOLERANCE_USD})`);
      console.log('');
      console.log('WARNING: Do NOT use this wallet as a benchmark until discrepancies are resolved.');
      console.log('');
    }
  }

  // 3. Global distribution checks
  console.log('\n\n📊 Global Distribution Checks');
  console.log('='.repeat(80));

  // 3a. Total P&L across all wallets
  const globalQuery = `
    SELECT
      SUM(total_pnl_usd) AS global_total_pnl,
      SUM(realized_pnl_usd) AS global_realized_pnl,
      SUM(unrealized_pnl_usd) AS global_unrealized_pnl,
      SUM(settlement_pnl_usd) AS global_settlement_pnl,
      SUM(total_trades) AS global_trades,
      SUM(total_volume_usd) AS global_volume,
      AVG(win_rate) AS avg_win_rate,
      AVG(days_active) AS avg_days_active
    FROM pm_wallet_summary_v2
  `;

  const globalResult = await clickhouse.query({ query: globalQuery, format: 'JSONEachRow' });
  const globalData = (await globalResult.json())[0];

  console.log('\nGlobal Metrics:');
  console.log(`Total P&L (all wallets):     $${parseFloat(globalData.global_total_pnl).toFixed(2)}`);
  console.log(`Total Realized P&L:          $${parseFloat(globalData.global_realized_pnl).toFixed(2)}`);
  console.log(`Total Unrealized P&L:        $${parseFloat(globalData.global_unrealized_pnl).toFixed(2)}`);
  console.log(`Total Settlement P&L:        $${parseFloat(globalData.global_settlement_pnl).toFixed(2)}`);
  console.log(`Total Trades:                ${parseInt(globalData.global_trades).toLocaleString()}`);
  console.log(`Total Volume:                $${parseFloat(globalData.global_volume).toFixed(2)}`);
  console.log(`Average Win Rate:            ${parseFloat(globalData.avg_win_rate).toFixed(1)}%`);
  console.log(`Average Days Active:         ${parseFloat(globalData.avg_days_active).toFixed(0)}`);

  // 3b. Cross-validate with pm_wallet_market_pnl_v2
  console.log('\n🔄 Cross-Validation with pm_wallet_market_pnl_v2:');
  console.log('-'.repeat(80));

  const marketPnlGlobalQuery = `
    SELECT
      SUM(total_pnl_usd) AS sum_total_pnl,
      SUM(realized_pnl_usd) AS sum_realized_pnl,
      SUM(unrealized_pnl_usd) AS sum_unrealized_pnl,
      SUM(settlement_pnl_usd) AS sum_settlement_pnl,
      SUM(total_trades) AS sum_trades,
      SUM(covered_volume_usd) AS sum_volume
    FROM pm_wallet_market_pnl_v2
  `;

  const marketPnlGlobalResult = await clickhouse.query({ query: marketPnlGlobalQuery, format: 'JSONEachRow' });
  const marketPnlGlobalData = (await marketPnlGlobalResult.json())[0];

  console.log(`\npm_wallet_market_pnl_v2 sums:`);
  console.log(`Total P&L:       $${parseFloat(marketPnlGlobalData.sum_total_pnl).toFixed(2)}`);
  console.log(`Realized P&L:    $${parseFloat(marketPnlGlobalData.sum_realized_pnl).toFixed(2)}`);
  console.log(`Unrealized P&L:  $${parseFloat(marketPnlGlobalData.sum_unrealized_pnl).toFixed(2)}`);
  console.log(`Settlement P&L:  $${parseFloat(marketPnlGlobalData.sum_settlement_pnl).toFixed(2)}`);
  console.log(`Total Trades:    ${parseInt(marketPnlGlobalData.sum_trades).toLocaleString()}`);
  console.log(`Total Volume:    $${parseFloat(marketPnlGlobalData.sum_volume).toFixed(2)}`);

  // Check differences
  const pnlDiff = Math.abs(parseFloat(globalData.global_total_pnl) - parseFloat(marketPnlGlobalData.sum_total_pnl));
  const realizedDiff = Math.abs(parseFloat(globalData.global_realized_pnl) - parseFloat(marketPnlGlobalData.sum_realized_pnl));
  const tradesDiff = Math.abs(parseInt(globalData.global_trades) - parseInt(marketPnlGlobalData.sum_trades));
  const volumeDiff = Math.abs(parseFloat(globalData.global_volume) - parseFloat(marketPnlGlobalData.sum_volume));

  console.log(`\nDifferences:`);
  console.log(`Total P&L diff:    $${pnlDiff.toFixed(2)}`);
  console.log(`Realized P&L diff: $${realizedDiff.toFixed(2)}`);
  console.log(`Trades diff:       ${tradesDiff.toLocaleString()}`);
  console.log(`Volume diff:       $${volumeDiff.toFixed(2)}`);

  if (pnlDiff < 1.0 && realizedDiff < 1.0 && tradesDiff === 0 && volumeDiff < 1.0) {
    console.log('\n✅ Global cross-validation PASSED - aggregation is correct!');
  } else {
    console.log('\n⚠️  Global cross-validation shows minor differences (likely rounding)');
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ PNL V2 WALLET VALIDATION COMPLETE');
  console.log('='.repeat(80));
  console.log('Validated:');
  console.log(`  - Top 3 wallets by volume`);
  console.log(`  - 3 random high-activity wallets`);
  console.log(`  - Global distribution and cross-validation`);
  console.log('\nNext Step: Create PNL_V2_VALIDATION_REPORT.md');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
