import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculatePnLWithVwTradesCanonical() {
  console.log('=== Re-calculating PnL using vw_trades_canonical (1,384 trades) ===\n');

  // First, check the schema
  const schemaQuery = `DESCRIBE vw_trades_canonical`;
  const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
  const schema = await schemaResult.json<any[]>();

  console.log('Schema of vw_trades_canonical:');
  schema.forEach(col => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log('');

  // Calculate PnL using vw_trades_canonical
  const pnlQuery = `
    WITH
      positions AS (
        SELECT
          condition_id_norm AS condition_id,
          outcome_index AS outcome_idx,
          sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
          sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
          count() AS trade_count
        FROM vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${EOA}')
          AND condition_id_norm IS NOT NULL
          AND condition_id_norm != ''
          AND condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
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

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('      xcnstrategy PnL from vw_trades_canonical (1,384 trades)            ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
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
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const polymarketPnL = 87030.51;
  const oldPnL = -406642.64;
  const difference = metrics.net_pnl - polymarketPnL;
  const percentError = Math.abs(difference / polymarketPnL) * 100;
  const improvement = metrics.net_pnl - oldPnL;

  console.log('Comparison to Reality:');
  console.log('  Polymarket PnL:       $' + polymarketPnL.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Old PnL (v3, 780):    $' + oldPnL.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  NEW PnL (canon, 1384):$' + metrics.net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  Improvement:          $' + improvement.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Remaining Error:      $' + difference.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  % Error:              ' + percentError.toFixed(2) + '%');
  console.log('');

  if (percentError < 5) {
    console.log('✅✅✅ SUCCESS! Error < 5%! Mission accomplished!');
  } else if (percentError < 20) {
    console.log('✅✅ MAJOR PROGRESS! Getting very close...');
  } else if (improvement > 100000) {
    console.log('✅ BREAKTHROUGH! Massive improvement!');
  } else if (improvement > 10000) {
    console.log('✅ GOOD PROGRESS! Significant improvement!');
  } else {
    console.log('❌ Still substantial error.');
  }
  console.log('');

  // Check how many positions are unresolved
  const unresolvedQuery = `
    WITH positions AS (
      SELECT
        condition_id_norm AS condition_id,
        outcome_index AS outcome_idx,
        sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
        sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost
      FROM vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${EOA}')
        AND condition_id_norm IS NOT NULL
        AND condition_id_norm != ''
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      count() AS total_positions,
      countIf(r.payout_denominator > 0) AS resolved_count,
      countIf(r.payout_denominator = 0 OR r.condition_id_norm IS NULL) AS unresolved_count
    FROM positions p
    LEFT JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
  `;

  const unresolvedResult = await clickhouse.query({ query: unresolvedQuery, format: 'JSONEachRow' });
  const unresolvedData = await unresolvedResult.json<any[]>();

  console.log('Position Coverage:');
  console.log(`  Total positions: ${unresolvedData[0].total_positions}`);
  console.log(`  Resolved: ${unresolvedData[0].resolved_count} (${((unresolvedData[0].resolved_count / unresolvedData[0].total_positions) * 100).toFixed(1)}%)`);
  console.log(`  Unresolved: ${unresolvedData[0].unresolved_count} (${((unresolvedData[0].unresolved_count / unresolvedData[0].total_positions) * 100).toFixed(1)}%)`);
  console.log('');
}

calculatePnLWithVwTradesCanonical().catch(console.error);
