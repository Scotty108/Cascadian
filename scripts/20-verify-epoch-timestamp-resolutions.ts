import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function verifyEpochTimestampResolutions() {
  console.log('=== Verifying "Epoch Timestamp" Resolutions ===\n');
  console.log('Hypothesis: Records with epoch timestamps may have VALID payout data!\n');

  // Get the 83 "corrupted" records
  const query = `
    SELECT
      condition_id_norm,
      payout_numerators,
      payout_denominator,
      winning_outcome,
      winning_index,
      source,
      version,
      updated_at
    FROM market_resolutions_final
    WHERE updated_at = '1970-01-01 00:00:00'
    LIMIT 10
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const records = await result.json<any[]>();

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SAMPLE "EPOCH TIMESTAMP" RECORDS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  let validPayouts = 0;
  let invalidPayouts = 0;

  records.forEach((rec, i) => {
    const payoutArray = Array.isArray(rec.payout_numerators) ? rec.payout_numerators : JSON.parse(rec.payout_numerators);
    const isValid = rec.payout_denominator > 0 && payoutArray.some((n: number) => n > 0);

    console.log(`[${i + 1}] ${rec.condition_id_norm.substring(0, 16)}...`);
    console.log(`    Payout: [${payoutArray.join(', ')}]/${rec.payout_denominator}`);
    console.log(`    Winner: ${rec.winning_outcome} (index=${rec.winning_index})`);
    console.log(`    Valid: ${isValid ? '✅ YES' : '❌ NO'}`);
    console.log('');

    if (isValid) validPayouts++;
    else invalidPayouts++;
  });

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`Valid payouts in sample: ${validPayouts}/${records.length}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Now check ALL epoch timestamp records
  const countQuery = `
    SELECT
      countIf(payout_denominator > 0) AS valid_payout_count,
      countIf(payout_denominator = 0) AS invalid_payout_count,
      count() AS total
    FROM market_resolutions_final
    WHERE updated_at = '1970-01-01 00:00:00'
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const counts = await countResult.json<any[]>();

  console.log('FULL ANALYSIS OF EPOCH TIMESTAMP RECORDS:');
  console.log(`  Total records: ${counts[0].total}`);
  console.log(`  Valid payouts (denom > 0): ${counts[0].valid_payout_count} (${((counts[0].valid_payout_count / counts[0].total) * 100).toFixed(1)}%)`);
  console.log(`  Invalid payouts (denom = 0): ${counts[0].invalid_payout_count} (${((counts[0].invalid_payout_count / counts[0].total) * 100).toFixed(1)}%)`);
  console.log('');

  // 🚨 KEY TEST: Re-calculate PnL INCLUDING epoch timestamp records
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔥 BREAKTHROUGH TEST: Re-calculating PnL INCLUDING epoch timestamp records!');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

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
        WHERE r.payout_denominator > 0  -- CHANGED: Now includes epoch timestamp records!
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

  const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const pnl = await pnlResult.json<any[]>();

  const metrics = {
    total_positions: Number(pnl[0].total_positions),
    total_trades: Number(pnl[0].total_trades),
    total_volume: Number(pnl[0].total_volume),
    total_profit: Number(pnl[0].total_profit),
    total_loss: Number(pnl[0].total_loss),
    net_pnl: Number(pnl[0].net_pnl),
    winning_positions: Number(pnl[0].winning_positions),
    losing_positions: Number(pnl[0].losing_positions),
  };

  console.log('📊 NEW PNL CALCULATION (INCLUDING EPOCH TIMESTAMPS):');
  console.log('─'.repeat(79));
  console.log(`  Resolved Positions: ${metrics.total_positions}`);
  console.log(`  Total Trades: ${metrics.total_trades}`);
  console.log(`  Total Volume: $${metrics.total_volume.toFixed(2)}`);
  console.log('');
  console.log(`  Total Profit: $${metrics.total_profit.toFixed(2)}`);
  console.log(`  Total Loss: -$${Math.abs(metrics.total_loss).toFixed(2)}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  NET PnL: ${metrics.net_pnl >= 0 ? '✅' : '❌'} $${metrics.net_pnl.toFixed(2)}`);
  console.log('');
  console.log(`  Win Rate: ${((metrics.winning_positions / metrics.total_positions) * 100).toFixed(1)}%`);
  console.log(`    Winning: ${metrics.winning_positions}`);
  console.log(`    Losing: ${metrics.losing_positions}`);
  console.log('');

  const polymarketPnL = 87030.51;
  const oldPnL = -406642.64;
  const difference = metrics.net_pnl - polymarketPnL;
  const percentError = (Math.abs(difference) / polymarketPnL) * 100;
  const improvement = metrics.net_pnl - oldPnL;

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO REALITY:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`  Polymarket Reality: $${polymarketPnL.toFixed(2)}`);
  console.log(`  Old Calculation: $${oldPnL.toFixed(2)} (78 positions)`);
  console.log(`  NEW Calculation: $${metrics.net_pnl.toFixed(2)} (${metrics.total_positions} positions)`);
  console.log('');
  console.log(`  Improvement: $${improvement.toFixed(2)} (${Math.abs(improvement / oldPnL * 100).toFixed(1)}% better)`);
  console.log(`  Remaining Error: $${difference.toFixed(2)} (${percentError.toFixed(1)}%)`);
  console.log('');

  if (percentError < 5) {
    console.log('✅✅✅ SUCCESS! Error < 5%!');
  } else if (percentError < 20) {
    console.log('✅ MAJOR IMPROVEMENT! Getting close...');
  } else if (improvement > 50000) {
    console.log('✅ BREAKTHROUGH! Significant improvement!');
  } else {
    console.log('❌ Still substantial error remaining.');
  }

  console.log('');
}

verifyEpochTimestampResolutions().catch(console.error);
