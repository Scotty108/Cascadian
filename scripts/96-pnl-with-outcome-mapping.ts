#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Calculating P&L with outcome index → string mapping...\n`);

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
          -- Map outcome_idx to string: 0='NO', 1='YES'
          if(t.outcome_idx = 0, 'NO', if(t.outcome_idx = 1, 'YES', toString(t.outcome_idx))) AS outcome_str,
          if(
            r.payout_denominator = 0
              OR r.payout_denominator IS NULL
              OR length(r.payout_numerators) < t.outcome_idx + 1,
            0,
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
          ) AS payout_per_share,
          (t.net_shares * payout_per_share) + t.proceeds_sell - t.cost_buy AS position_pnl,
          -- Check if this position won
          trim(outcome_str) = trim(r.winning_outcome) AS is_winning_outcome
        FROM trades_by_market t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
        WHERE r.winning_outcome IS NOT NULL
          AND r.winning_outcome != ''  -- Exclude empty/unresolved
      )
      SELECT
        count() AS total_positions,
        countIf(is_winning_outcome) AS positions_on_winner,
        countIf(NOT is_winning_outcome) AS positions_on_loser,

        -- ALL positions P&L
        sumIf(position_pnl, position_pnl > 0) AS all_wins,
        sumIf(position_pnl, position_pnl < 0) AS all_losses,
        sum(position_pnl) AS all_net,

        -- WINNING outcome positions only
        sumIf(position_pnl, is_winning_outcome AND position_pnl > 0) AS winner_profits,
        sumIf(position_pnl, is_winning_outcome AND position_pnl < 0) AS winner_losses,
        sumIf(position_pnl, is_winning_outcome) AS winner_net,

        -- LOSING outcome positions only
        sumIf(position_pnl, NOT is_winning_outcome AND position_pnl > 0) AS loser_profits,
        sumIf(position_pnl, NOT is_winning_outcome AND position_pnl < 0) AS loser_losses,
        sumIf(position_pnl, NOT is_winning_outcome) AS loser_net
      FROM with_resolutions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POSITION BREAKDOWN:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Resolved:          ${parseInt(r.total_positions)}`);
  console.log(`  On Winning Outcome:      ${parseInt(r.positions_on_winner)}`);
  console.log(`  On Losing Outcome:       ${parseInt(r.positions_on_loser)}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ALL POSITIONS (current calculation):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Wins:   $${parseFloat(r.all_wins).toLocaleString()}`);
  console.log(`  Losses: $${parseFloat(r.all_losses).toLocaleString()}`);
  console.log(`  Net:    $${parseFloat(r.all_net).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('WINNING OUTCOME POSITIONS ONLY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Profits: $${parseFloat(r.winner_profits).toLocaleString()}`);
  console.log(`  Losses:  $${parseFloat(r.winner_losses).toLocaleString()}`);
  console.log(`  Net:     $${parseFloat(r.winner_net).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('LOSING OUTCOME POSITIONS ONLY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Profits: $${parseFloat(r.loser_profits).toLocaleString()}`);
  console.log(`  Losses:  $${parseFloat(r.loser_losses).toLocaleString()}`);
  console.log(`  Net:     $${parseFloat(r.loser_net).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON WITH POLYMARKET:');
  console.log('═══════════════════════════════════════════════════════════════');

  const pmGains = 376597.39;
  const pmLosses = 190734.84;
  const pmNet = 184862.55;

  const winnerProfits = parseFloat(r.winner_profits);
  const winnerLosses = Math.abs(parseFloat(r.winner_losses));
  const winnerNet = parseFloat(r.winner_net);

  console.log('\nWinning Outcome Positions:');
  console.log(`  Polymarket Gains:  $${pmGains.toLocaleString()}`);
  console.log(`  Our Profits:       $${winnerProfits.toLocaleString()}`);
  console.log(`  Match:             ${Math.abs(winnerProfits - pmGains) < 50000 ? '✅' : '❌'}`);
  console.log();
  console.log(`  Polymarket Losses: $${pmLosses.toLocaleString()}`);
  console.log(`  Our Losses:        $${winnerLosses.toLocaleString()}`);
  console.log(`  Match:             ${Math.abs(winnerLosses - pmLosses) < 50000 ? '✅' : '❌'}`);
  console.log();
  console.log(`  Polymarket Net:    $${pmNet.toLocaleString()}`);
  console.log(`  Our Net:           $${winnerNet.toLocaleString()}`);
  console.log(`  Match:             ${Math.abs(winnerNet - pmNet) < 50000 ? '✅' : '❌'}`);
}

main().catch(console.error);
