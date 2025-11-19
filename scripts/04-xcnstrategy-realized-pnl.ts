import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

const CHOSEN_VIEW = 'vw_trades_canonical_current';
const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface PnLMetrics {
  total_volume: number;
  total_profit: number;
  total_loss: number;
  net_pnl: number;
  winning_trades: number;
  losing_trades: number;
  total_resolved_trades: number;
  win_rate: number;
}

async function calculateRealizedPnL() {
  console.log('=== Calculating Realized PnL for xcnstrategy ===\n');
  console.log('Wallet:', XCNSTRATEGY_WALLET);
  console.log('');

  // Strategy: Build position-level PnL by aggregating trades per condition and outcome
  // Then join with resolutions to determine winners/losers

  const pnlQuery = `
    WITH
      -- Step 1: Aggregate all trades by condition_id and outcome_index to get positions
      positions AS (
        SELECT
          canonical_condition_id,
          canonical_outcome_index,
          sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
          sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
          count() AS trade_count,
          min(timestamp) AS first_trade,
          max(timestamp) AS last_trade
        FROM ${CHOSEN_VIEW}
        WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
          AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY canonical_condition_id, canonical_outcome_index
        HAVING abs(net_shares) > 0.001  -- Filter out fully closed positions
      ),

      -- Step 2: Join with resolutions to determine winning/losing outcomes
      resolved_positions AS (
        SELECT
          p.canonical_condition_id,
          p.canonical_outcome_index,
          p.net_shares,
          p.net_cost,
          p.trade_count,
          p.first_trade,
          p.last_trade,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          r.resolved_at,
          -- Determine if this position won
          if(p.canonical_outcome_index = r.winning_index, 1, 0) AS is_winner,
          -- Calculate payout value (shares * payout_ratio)
          if(
            r.payout_denominator > 0,
            toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.canonical_outcome_index + 1)) / toFloat64(r.payout_denominator)),
            0
          ) AS payout_value,
          -- Calculate realized PnL (payout - cost)
          if(
            r.payout_denominator > 0,
            (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.canonical_outcome_index + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
            -toFloat64(p.net_cost)  -- If no payout info, assume total loss
          ) AS realized_pnl
        FROM positions p
        INNER JOIN market_resolutions_final r
          ON p.canonical_condition_id = r.condition_id_norm
        WHERE r.payout_denominator > 0  -- Has valid payout data (resolved)
      )

    -- Step 3: Aggregate overall metrics
    SELECT
      count() AS total_resolved_positions,
      sum(trade_count) AS total_resolved_trades,
      sum(abs(net_cost)) AS total_volume,
      sumIf(realized_pnl, realized_pnl > 0) AS total_profit,
      sumIf(realized_pnl, realized_pnl < 0) AS total_loss,
      sum(realized_pnl) AS net_pnl,
      countIf(realized_pnl > 0) AS winning_positions,
      countIf(realized_pnl < 0) AS losing_positions,
      round(100.0 * countIf(realized_pnl > 0) / count(), 2) AS win_rate_pct
    FROM resolved_positions
  `;

  console.log('Running PnL calculation query...\n');

  const result = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const rawData = await result.json<any[]>();

  if (rawData.length === 0 || !rawData[0]) {
    console.log('⚠️  No resolved positions found for this wallet.');
    return null;
  }

  const data = rawData[0];

  const metrics: PnLMetrics = {
    total_volume: Number(data.total_volume) || 0,
    total_profit: Number(data.total_profit) || 0,
    total_loss: Number(data.total_loss) || 0,
    net_pnl: Number(data.net_pnl) || 0,
    winning_trades: Number(data.winning_positions) || 0,
    losing_trades: Number(data.losing_positions) || 0,
    total_resolved_trades: Number(data.total_resolved_trades) || 0,
    win_rate: Number(data.win_rate_pct) || 0,
  };

  console.log('✅ PnL Calculation Complete\n');

  displayPnLMetrics(metrics);

  // Also get detailed position breakdown
  await getDetailedBreakdown();

  return metrics;
}

function displayPnLMetrics(metrics: PnLMetrics) {
  console.log('═══════════════════════════════════════════════════════');
  console.log('         xcnstrategy REALIZED PNL (Database)           ');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 VOLUME & ACTIVITY');
  console.log('  Total Volume (absolute):  $' + metrics.total_volume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log('  Resolved Trades:          ' + metrics.total_resolved_trades.toLocaleString());
  console.log('');
  console.log('💰 PROFIT & LOSS');
  console.log('  Total Profit:             $' + metrics.total_profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log('  Total Loss:               $' + Math.abs(metrics.total_loss).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log('  ─────────────────────────────────────────────────');
  const netPnlColor = metrics.net_pnl >= 0 ? '✅' : '❌';
  console.log(`  NET PnL:                  ${netPnlColor} $${metrics.net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');
  console.log('📈 WIN RATE');
  console.log('  Winning Positions:        ' + metrics.winning_trades.toLocaleString());
  console.log('  Losing Positions:         ' + metrics.losing_trades.toLocaleString());
  console.log('  Win Rate:                 ' + metrics.win_rate.toFixed(2) + '%');
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
}

async function getDetailedBreakdown() {
  console.log('Getting detailed breakdown by month...\n');

  const breakdownQuery = `
    WITH
      positions AS (
        SELECT
          canonical_condition_id,
          canonical_outcome_index,
          sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
          sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
          min(timestamp) AS first_trade,
          max(timestamp) AS last_trade
        FROM ${CHOSEN_VIEW}
        WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
          AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY canonical_condition_id, canonical_outcome_index
        HAVING abs(net_shares) > 0.001
      ),

      resolved_positions AS (
        SELECT
          toYYYYMM(p.last_trade) AS trade_month,
          toYYYYMM(r.resolved_at) AS resolution_month,
          p.net_cost,
          if(
            r.payout_denominator > 0,
            (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.canonical_outcome_index + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
            -toFloat64(p.net_cost)
          ) AS realized_pnl
        FROM positions p
        INNER JOIN market_resolutions_final r
          ON p.canonical_condition_id = r.condition_id_norm
        WHERE r.payout_denominator > 0  -- Has valid payout data (resolved)
      )

    SELECT
      resolution_month AS month,
      count() AS positions_resolved,
      sum(abs(net_cost)) AS volume,
      sumIf(realized_pnl, realized_pnl > 0) AS profit,
      sumIf(realized_pnl, realized_pnl < 0) AS loss,
      sum(realized_pnl) AS net_pnl
    FROM resolved_positions
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `;

  const result = await clickhouse.query({ query: breakdownQuery, format: 'JSONEachRow' });
  const rawData = await result.json<any[]>();

  if (rawData.length === 0) {
    console.log('  No monthly data available.\n');
    return;
  }

  console.log('Monthly Breakdown (by resolution date, last 12 months):');
  console.log('');
  console.log('┌─────────┬────────────┬─────────────┬─────────────┬─────────────┬─────────────┐');
  console.log('│  Month  │ Positions  │   Volume    │   Profit    │    Loss     │   Net PnL   │');
  console.log('├─────────┼────────────┼─────────────┼─────────────┼─────────────┼─────────────┤');

  rawData.forEach((row) => {
    const monthStr = String(row.month);
    const year = monthStr.substring(0, 4);
    const month = monthStr.substring(4, 6);
    const monthDisplay = `${year}-${month}`;
    const positions = String(row.positions_resolved).padStart(10);
    const volume = '$' + Number(row.volume).toFixed(0).padStart(10);
    const profit = '$' + Number(row.profit).toFixed(0).padStart(10);
    const loss = '$' + Math.abs(Number(row.loss)).toFixed(0).padStart(10);
    const netPnl = Number(row.net_pnl);
    const netPnlStr = (netPnl >= 0 ? '+$' : '-$') + Math.abs(netPnl).toFixed(0).padStart(9);

    console.log(`│ ${monthDisplay} │ ${positions} │ ${volume} │ ${profit} │ ${loss} │ ${netPnlStr} │`);
  });

  console.log('└─────────┴────────────┴─────────────┴─────────────┴─────────────┴─────────────┘');
  console.log('');
}

calculateRealizedPnL().catch(console.error);
