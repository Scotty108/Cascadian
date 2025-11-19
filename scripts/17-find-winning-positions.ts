import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function findWinningPositions() {
  console.log('=== Finding WINNING Positions ===\n');

  // Get positions where the wallet WON
  const query = `
    WITH positions AS (
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
        r.winning_outcome,
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
      condition_id,
      outcome_idx,
      net_shares,
      net_cost,
      trade_count,
      winning_index,
      winning_outcome,
      realized_pnl,
      arrayElement(payout_numerators, outcome_idx + 1) AS my_payout_numerator,
      payout_denominator
    FROM resolved_positions
    WHERE realized_pnl > 0
    ORDER BY realized_pnl DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const winners = await result.json<any[]>();

  console.log(`Found ${winners.length} WINNING positions!\n`);

  if (winners.length === 0) {
    console.log('🚨 CRITICAL FINDING: ZERO WINNING POSITIONS!');
    console.log('');
    console.log('This means either:');
    console.log('  1. The wallet legitimately has 0 wins (highly unlikely given 78 resolved positions)');
    console.log('  2. There is a bug in how we identify winning positions');
    console.log('  3. The resolution data has the winning_index wrong');
    console.log('');
  } else {
    console.log('═══════════════════════════════════════════════════════════════════════════════');

    let totalWinnings = 0;

    winners.slice(0, 10).forEach((win, i) => {
      console.log(`\n[${i + 1}] WINNER:`);
      console.log(`  Condition ID: ${win.condition_id}`);
      console.log(`  Outcome Index: ${win.outcome_idx}`);
      console.log(`  Winning Index: ${win.winning_index}`);
      console.log(`  Winning Outcome: ${win.winning_outcome}`);
      console.log(`  My Payout: ${win.my_payout_numerator}/${win.payout_denominator}`);
      console.log(`  Net Shares: ${Number(win.net_shares).toFixed(2)}`);
      console.log(`  Net Cost: $${Number(win.net_cost).toFixed(2)}`);
      console.log(`  Realized PnL: $${Number(win.realized_pnl).toFixed(2)} ✅`);

      totalWinnings += Number(win.realized_pnl);
    });

    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log('\nSUMMARY OF WINS:');
    console.log(`  Total winning positions: ${winners.length}`);
    console.log(`  Total winnings (all): $${winners.reduce((sum, w) => sum + Number(w.realized_pnl), 0).toFixed(2)}`);
    console.log(`  Total winnings (top 10): $${totalWinnings.toFixed(2)}`);
  }

  // Also check: what if we have the outcome_idx mapping wrong?
  console.log('\n\nChecking if outcome_idx mapping might be off...\n');

  const checkMappingQuery = `
    WITH positions AS (
      SELECT
        condition_id_norm_v3 AS condition_id,
        outcome_index_v3 AS outcome_idx,
        sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
        sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      p.condition_id,
      p.outcome_idx,
      r.winning_index,
      countIf(p.outcome_idx = r.winning_index) AS idx_matches_winning,
      countIf(p.outcome_idx != r.winning_index) AS idx_not_matching
    FROM positions p
    INNER JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator > 0
    GROUP BY p.condition_id, p.outcome_idx, r.winning_index
    HAVING idx_matches_winning > 0
    LIMIT 20
  `;

  const mappingResult = await clickhouse.query({ query: checkMappingQuery, format: 'JSONEachRow' });
  const mapping = await mappingResult.json<any[]>();

  if (mapping.length > 0) {
    console.log('Found positions where outcome_idx MATCHES winning_index:');
    console.log(`  Count: ${mapping.length}`);
    console.log('  Sample:');
    mapping.slice(0, 5).forEach(m => {
      console.log(`    Condition: ${m.condition_id.substring(0, 16)}... | outcome=${m.outcome_idx}, winning=${m.winning_index}`);
    });
  } else {
    console.log('❌ NO positions found where outcome_idx matches winning_index!');
    console.log('   This suggests the wallet never bet on a winning outcome.');
  }

  console.log('');
}

findWinningPositions().catch(console.error);
