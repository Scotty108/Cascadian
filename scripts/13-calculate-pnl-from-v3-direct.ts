import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculatePnLFromV3Direct() {
  console.log('=== Calculating PnL Directly from pm_trades_canonical_v3 ===\n');

  // Use the v3 table directly
  const pnlQuery = `
    WITH
      positions AS (
        SELECT
          condition_id_norm_v3 AS condition_id,
          outcome_index_v3 AS outcome_idx,
          sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
          sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
          count() AS trade_count
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${EOA}')
          AND condition_id_norm_v3 IS NOT NULL
          AND condition_id_norm_v3 != ''
          AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY condition_id, outcome_idx
        HAVING abs(net_shares) > 0.001
      ),

      resolved_positions AS (
        SELECT
          p.condition_id,
          p.outcome_idx,
          p.net_shares,
          p.net_cost,
          p.trade_count,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          if(
            r.payout_denominator > 0,
            (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
            -toFloat64(p.net_cost)
          ) AS realized_pnl
        FROM positions p
        INNER JOIN market_resolutions_final r
          ON p.condition_id = r.condition_id_norm
        WHERE r.payout_denominator > 0
      )

    SELECT
      count() AS total_positions,
      sum(trade_count) AS total_trades,
      sum(abs(net_cost)) AS total_volume,
      sumIf(realized_pnl, realized_pnl > 0) AS total_profit,
      sumIf(realized_pnl, realized_pnl < 0) AS total_loss,
      sum(realized_pnl) AS net_pnl,
      countIf(realized_pnl > 0) AS winning_positions,
      countIf(realized_pnl < 0) AS losing_positions
    FROM resolved_positions
  `;

  const result = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  const metrics = {
    total_positions: Number(data[0].total_positions),
    total_trades: Number(data[0].total_trades),
    total_volume: Number(data[0].total_volume),
    total_profit: Number(data[0].total_profit),
    total_loss: Number(data[0].total_loss),
    net_pnl: Number(data[0].net_pnl),
    winning_positions: Number(data[0].winning_positions),
    losing_positions: Number(data[0].losing_positions),
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('      xcnstrategy PNL from pm_trades_canonical_v3             ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 VOLUME & ACTIVITY');
  console.log('  Total Volume:         $' + metrics.total_volume.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Resolved Trades:      ' + metrics.total_trades.toLocaleString());
  console.log('  Resolved Positions:   ' + metrics.total_positions);
  console.log('');
  console.log('💰 PROFIT & LOSS');
  console.log('  Total Profit:         $' + metrics.total_profit.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Total Loss:           -$' + Math.abs(metrics.total_loss).toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  NET PnL:              ' + (metrics.net_pnl >= 0 ? '✅' : '❌') + ' $' + metrics.net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('');
  console.log('📈 WIN RATE');
  console.log('  Winning Positions:    ' + metrics.winning_positions);
  console.log('  Losing Positions:     ' + metrics.losing_positions);
  console.log('  Win Rate:             ' + ((metrics.winning_positions / metrics.total_positions) * 100).toFixed(2) + '%');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const polymarketPnL = 87030.505;
  const difference = metrics.net_pnl - polymarketPnL;
  const percentError = (Math.abs(difference) / polymarketPnL) * 100;

  console.log('Comparison to Polymarket Reality:');
  console.log('  Polymarket PnL:       $' + polymarketPnL.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Our V3 PnL:           $' + metrics.net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Difference:           $' + difference.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  % Error:              ' + percentError.toFixed(2) + '%');
  console.log('');

  if (Math.abs(difference) < 5000) {
    console.log('✅✅ MATCH! V3 calculation is very close to Polymarket reality!');
  } else {
    console.log('❌ Still a significant discrepancy.');
  }
  console.log('');
}

calculatePnLFromV3Direct().catch(console.error);
