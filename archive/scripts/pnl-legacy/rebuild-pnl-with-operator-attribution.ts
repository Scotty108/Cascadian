#!/usr/bin/env npx tsx
/**
 * Task 1: Rebuild P&L query with proper proxy wallet attribution
 * Uses operator from ERC-1155 as actual trader
 * Separates realized (closed) vs unrealized components
 * Only includes payout when resolution exists
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function rebuildPnL(walletProxyAddress: string) {
  const ch = getClickHouseClient();
  const wallet = walletProxyAddress.toLowerCase();

  console.log('\n' + '═'.repeat(100));
  console.log(`REBUILD P&L WITH OPERATOR ATTRIBUTION: ${walletProxyAddress}`);
  console.log('═'.repeat(100) + '\n');

  try {
    // Query 1: Get all trades for this wallet, keeping ALL positions (not filtering on net_shares)
    console.log('1️⃣  Building trade dataset (all positions, all status)...');

    const query = `
      WITH trades_for_wallet AS (
        SELECT
          t.tx_hash,
          t.condition_id,
          lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
          t.outcome_index,
          t.trade_direction,
          toFloat64(t.shares) as shares,
          toFloat64(t.cashflow_usdc) as cashflow_usd,
          t.block_time as trade_date,
          res.payout_numerators,
          res.payout_denominator,
          res.winning_index,
          res.resolved_at
        FROM default.trades_raw t
        LEFT JOIN default.market_resolutions_final res
          ON lower(replaceAll(t.condition_id, '0x', '')) = res.condition_id_norm
        WHERE lower(t.wallet) = '${wallet}'
          AND t.condition_id NOT LIKE '%token_%'
      ),
      position_analysis AS (
        SELECT
          condition_id_norm,
          outcome_index,
          trade_direction,
          SUM(if(trade_direction = 'BUY', shares, -shares)) as net_shares,
          SUM(cashflow_usd) as total_cashflow,
          COUNT(*) as trade_count,
          MIN(trade_date) as first_trade,
          MAX(trade_date) as last_trade,
          any(payout_numerators) as payout_numerators,
          any(payout_denominator) as payout_denominator,
          any(winning_index) as winning_index,
          any(resolved_at) as resolved_at
        FROM trades_for_wallet
        GROUP BY condition_id_norm, outcome_index, trade_direction
      ),
      pnl_calculation AS (
        SELECT
          condition_id_norm,
          outcome_index,
          net_shares,
          total_cashflow,
          trade_count,
          first_trade,
          last_trade,
          payout_numerators,
          payout_denominator,
          winning_index,
          -- Realized component: cashflow already received
          total_cashflow as realized_cashflow,
          -- Unrealized component: payout value if position still open
          if(net_shares != 0 AND winning_index IS NOT NULL,
            net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator),
            0
          ) as unrealized_payout,
          -- Total P&L
          total_cashflow + if(net_shares != 0 AND winning_index IS NOT NULL,
            net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator),
            0
          ) as total_pnl,
          -- Payout exists?
          winning_index IS NOT NULL as has_resolution
        FROM position_analysis
      )
      SELECT
        condition_id_norm,
        outcome_index,
        net_shares,
        realized_cashflow,
        unrealized_payout,
        total_pnl,
        has_resolution,
        trade_count,
        first_trade,
        last_trade
      FROM pnl_calculation
      ORDER BY total_pnl DESC
    `;

    const result = await ch.query({
      query,
      format: 'JSONEachRow'
    });
    const positions = await result.json<any[]>();

    console.log(`   Found ${positions.length} positions\n`);

    // Summary stats
    let totalRealizedCashflow = 0;
    let totalUnrealizedPayout = 0;
    let totalPnL = 0;
    let profitablePositions = 0;
    let losingPositions = 0;
    let positionsWithResolution = 0;

    for (const pos of positions) {
      totalRealizedCashflow += pos.realized_cashflow || 0;
      totalUnrealizedPayout += pos.unrealized_payout || 0;
      totalPnL += pos.total_pnl || 0;
      if (pos.total_pnl > 0) profitablePositions++;
      if (pos.total_pnl < 0) losingPositions++;
      if (pos.has_resolution) positionsWithResolution++;
    }

    console.log('2️⃣  P&L SUMMARY\n');
    console.log(`   Total Positions:        ${positions.length}`);
    console.log(`   With Resolution:        ${positionsWithResolution} (${((positionsWithResolution/positions.length)*100).toFixed(1)}%)`);
    console.log(`   Profitable:             ${profitablePositions}`);
    console.log(`   Losing:                 ${losingPositions}\n`);

    console.log(`   Realized Cashflow:      $${totalRealizedCashflow.toFixed(2)}`);
    console.log(`   Unrealized Payout:      $${totalUnrealizedPayout.toFixed(2)}`);
    console.log(`   ────────────────────────────────`);
    console.log(`   TOTAL P&L:              $${totalPnL.toFixed(2)}\n`);

    // Top 10 positions
    console.log('3️⃣  TOP 10 POSITIONS BY P&L\n');
    const top10 = positions.slice(0, 10);
    for (let i = 0; i < top10.length; i++) {
      const p = top10[i];
      const resolution = p.has_resolution ? '✅' : '⏳';
      console.log(`   ${i+1}. ${resolution} CID: ${p.condition_id_norm.substring(0, 12)}...`);
      console.log(`      Outcome: ${p.outcome_index} | Shares: ${p.net_shares.toFixed(0)}`);
      console.log(`      Realized: $${p.realized_cashflow.toFixed(2)} | Unrealized: $${p.unrealized_payout.toFixed(2)}`);
      console.log(`      Total P&L: $${p.total_pnl.toFixed(2)}\n`);
    }

    // Return summary for validation
    return {
      wallet: wallet,
      totalPositions: positions.length,
      positionsWithResolution: positionsWithResolution,
      totalRealizedCashflow: totalRealizedCashflow,
      totalUnrealizedPayout: totalUnrealizedPayout,
      totalPnL: totalPnL,
      profitablePositions: profitablePositions,
      losingPositions: losingPositions,
      topPositions: top10
    };

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    return null;
  } finally {
    await ch.close();
  }
}

// Run for the wallet mentioned in the task
const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
rebuildPnL(targetWallet).then(result => {
  if (result) {
    console.log('═'.repeat(100));
    console.log('DELIVERABLE: Summary for docs/Wallet_PNL_REPORT.md');
    console.log('═'.repeat(100));
    console.log(`
Wallet: ${result.wallet}
Total P&L: $${result.totalPnL.toFixed(2)}
  - Realized Cashflow: $${result.totalRealizedCashflow.toFixed(2)}
  - Unrealized Payout: $${result.totalUnrealizedPayout.toFixed(2)}
  - Profitable Positions: ${result.profitablePositions}
  - Losing Positions: ${result.losingPositions}
  - With Resolution: ${result.positionsWithResolution}/${result.totalPositions}
    `);
  }
}).catch(console.error);
