#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Filtering by winning outcome only...\n`);

  const result = await clickhouse.query({
    query: `
      WITH trades_by_market AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
          shares_buy - shares_sell AS net_shares,
          sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
          sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell
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
          if(
            r.payout_denominator = 0
              OR r.payout_denominator IS NULL
              OR length(r.payout_numerators) < t.outcome_idx + 1,
            0,
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
          ) AS payout_per_share,
          (t.net_shares * payout_per_share) + t.proceeds_sell - t.cost_buy AS position_pnl
        FROM trades_by_market t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
        WHERE r.winning_outcome IS NOT NULL
          AND toString(t.outcome_idx) = toString(r.winning_outcome)  -- ONLY winning outcome
      )
      SELECT
        count() AS total_positions,
        countIf(position_pnl > 0) AS winning_positions,
        countIf(position_pnl < 0) AS losing_positions,

        sumIf(position_pnl, position_pnl > 0) AS total_wins,
        sumIf(position_pnl, position_pnl < 0) AS total_losses,
        sum(position_pnl) AS net_pnl
      FROM with_resolutions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('WINNING OUTCOME ONLY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions:     ${parseInt(r.total_positions)}`);
  console.log(`  Profitable:          ${parseInt(r.winning_positions)}`);
  console.log(`  Unprofitable:        ${parseInt(r.losing_positions)}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('P&L (Winning Outcome Only):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Wins:          $${parseFloat(r.total_wins).toLocaleString()}`);
  console.log(`  Total Losses:        $${parseFloat(r.total_losses).toLocaleString()}`);
  console.log(`  Net P&L:             $${parseFloat(r.net_pnl).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON WITH POLYMARKET:');
  console.log('═══════════════════════════════════════════════════════════════');

  const ourWins = parseFloat(r.total_wins);
  const ourLosses = Math.abs(parseFloat(r.total_losses));
  const ourNet = parseFloat(r.net_pnl);

  const pmGains = 376597.39;
  const pmLosses = 190734.84;
  const pmNet = 184862.55;

  console.log('\nGains/Wins:');
  console.log(`  Polymarket:  $${pmGains.toLocaleString()}`);
  console.log(`  Our calc:    $${ourWins.toLocaleString()}`);
  console.log(`  Difference:  $${(ourWins - pmGains).toLocaleString()}`);
  console.log(`  Match:       ${Math.abs(ourWins - pmGains) < 50000 ? '✅' : '❌'}`);

  console.log('\nLosses:');
  console.log(`  Polymarket:  $${pmLosses.toLocaleString()}`);
  console.log(`  Our calc:    $${ourLosses.toLocaleString()}`);
  console.log(`  Difference:  $${(ourLosses - pmLosses).toLocaleString()}`);
  console.log(`  Match:       ${Math.abs(ourLosses - pmLosses) < 50000 ? '✅' : '❌'}`);

  console.log('\nNet P&L:');
  console.log(`  Polymarket:  $${pmNet.toLocaleString()}`);
  console.log(`  Our calc:    $${ourNet.toLocaleString()}`);
  console.log(`  Difference:  $${(ourNet - pmNet).toLocaleString()}`);
  console.log(`  Match:       ${Math.abs(ourNet - pmNet) < 50000 ? '✅' : '❌'}`);
}

main().catch(console.error);
