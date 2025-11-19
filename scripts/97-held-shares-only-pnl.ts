#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Calculating P&L from HELD shares only (no trading profits)...\n`);

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
          if(t.outcome_idx = 0, 'NO', if(t.outcome_idx = 1, 'YES', toString(t.outcome_idx))) AS outcome_str,
          if(
            r.payout_denominator = 0
              OR r.payout_denominator IS NULL
              OR length(r.payout_numerators) < t.outcome_idx + 1,
            0,
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
          ) AS payout_per_share,

          -- Settlement value (only for held shares)
          if(t.net_shares > 0, t.net_shares * payout_per_share, 0) AS settlement_value,

          -- Cost of held shares (proportional to buy cost)
          if(t.net_shares > 0 AND t.shares_buy > 0,
            (t.net_shares / t.shares_buy) * t.cost_buy,
            0
          ) AS held_cost,

          -- P&L from held shares ONLY
          if(t.net_shares > 0,
            (t.net_shares * payout_per_share) - ((t.net_shares / t.shares_buy) * t.cost_buy),
            0
          ) AS held_pnl,

          trim(outcome_str) = trim(r.winning_outcome) AS is_winning_outcome
        FROM trades_by_market t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
        WHERE r.winning_outcome IS NOT NULL
          AND r.winning_outcome != ''
      )
      SELECT
        count() AS total_positions,
        countIf(net_shares > 0) AS positions_with_shares_held,
        countIf(net_shares <= 0) AS positions_fully_exited,
        countIf(is_winning_outcome AND net_shares > 0) AS winner_with_shares,
        countIf(is_winning_outcome AND net_shares <= 0) AS winner_exited,

        -- Held shares P&L (settlement - cost of held)
        sumIf(held_pnl, is_winning_outcome AND held_pnl > 0) AS winner_held_gains,
        sumIf(held_pnl, is_winning_outcome AND held_pnl < 0) AS winner_held_losses,
        sumIf(held_pnl, is_winning_outcome) AS winner_held_net,

        sumIf(held_pnl, NOT is_winning_outcome AND held_pnl > 0) AS loser_held_gains,
        sumIf(held_pnl, NOT is_winning_outcome AND held_pnl < 0) AS loser_held_losses,
        sumIf(held_pnl, NOT is_winning_outcome) AS loser_held_net,

        -- Combined
        sumIf(held_pnl, held_pnl > 0) AS total_held_gains,
        sumIf(held_pnl, held_pnl < 0) AS total_held_losses,
        sum(held_pnl) AS total_held_net
      FROM with_resolutions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POSITION STATUS:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions:         ${parseInt(r.total_positions)}`);
  console.log(`  With Shares Held:        ${parseInt(r.positions_with_shares_held)}`);
  console.log(`  Fully Exited:            ${parseInt(r.positions_fully_exited)}`);
  console.log('');
  console.log(`  Winners with shares:     ${parseInt(r.winner_with_shares)}`);
  console.log(`  Winners exited:          ${parseInt(r.winner_exited)}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('WINNING OUTCOME - HELD SHARES ONLY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Gains:  $${parseFloat(r.winner_held_gains).toLocaleString()}`);
  console.log(`  Losses: $${parseFloat(r.winner_held_losses).toLocaleString()}`);
  console.log(`  Net:    $${parseFloat(r.winner_held_net).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('LOSING OUTCOME - HELD SHARES ONLY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Gains:  $${parseFloat(r.loser_held_gains).toLocaleString()}`);
  console.log(`  Losses: $${parseFloat(r.loser_held_losses).toLocaleString()}`);
  console.log(`  Net:    $${parseFloat(r.loser_held_net).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ALL POSITIONS - HELD SHARES ONLY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Gains:  $${parseFloat(r.total_held_gains).toLocaleString()}`);
  console.log(`  Total Losses: $${parseFloat(r.total_held_losses).toLocaleString()}`);
  console.log(`  Net P&L:      $${parseFloat(r.total_held_net).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON WITH POLYMARKET:');
  console.log('═══════════════════════════════════════════════════════════════');

  const pmGains = 376597.39;
  const pmLosses = 190734.84;
  const pmNet = 184862.55;

  const heldGains = parseFloat(r.winner_held_gains);
  const heldLosses = Math.abs(parseFloat(r.winner_held_losses));
  const heldNet = parseFloat(r.winner_held_net);

  console.log('\nWinning Outcome (Held Shares Only):');
  console.log(`  Polymarket Gains:  $${pmGains.toLocaleString()}`);
  console.log(`  Our Gains:         $${heldGains.toLocaleString()}`);
  console.log(`  Difference:        $${(heldGains - pmGains).toLocaleString()}`);
  console.log(`  Match:             ${Math.abs(heldGains - pmGains) < 50000 ? '✅' : '❌'}`);
  console.log();
  console.log(`  Polymarket Losses: $${pmLosses.toLocaleString()}`);
  console.log(`  Our Losses:        $${heldLosses.toLocaleString()}`);
  console.log(`  Difference:        $${(heldLosses - pmLosses).toLocaleString()}`);
  console.log(`  Match:             ${Math.abs(heldLosses - pmLosses) < 50000 ? '✅' : '❌'}`);
  console.log();
  console.log(`  Polymarket Net:    $${pmNet.toLocaleString()}`);
  console.log(`  Our Net:           $${heldNet.toLocaleString()}`);
  console.log(`  Difference:        $${(heldNet - pmNet).toLocaleString()}`);
  console.log(`  Match:             ${Math.abs(heldNet - pmNet) < 50000 ? '✅' : '❌'}`);

  console.log();
  console.log('💡 HYPOTHESIS:');
  console.log('   If this matches, Polymarket only counts P&L from shares');
  console.log('   held until settlement, NOT trading profits from positions');
  console.log('   that were fully exited before market resolution.');
}

main().catch(console.error);
