#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Separating Trading P&L vs Settlement P&L...\n`);

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
          -- Settlement value (only for held shares)
          if(t.net_shares > 0, t.net_shares * payout_per_share, 0) AS settlement_value,
          -- Net cost of held shares
          if(t.net_shares > 0, (t.net_shares / t.shares_buy) * t.cost_buy, 0) AS held_cost,
          -- Trading P&L (from sold shares)
          t.proceeds_sell - if(t.net_shares > 0, (t.net_shares / t.shares_buy) * t.cost_buy, t.cost_buy) AS trading_pnl
        FROM trades_by_market t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
        WHERE r.winning_outcome IS NOT NULL
      )
      SELECT
        -- Position categories
        countIf(net_shares > 0) AS positions_with_shares,
        countIf(net_shares <= 0) AS positions_fully_exited,

        -- Trading P&L (from selling)
        sumIf(trading_pnl, trading_pnl > 0) AS trading_gains,
        sumIf(trading_pnl, trading_pnl < 0) AS trading_losses,
        sum(trading_pnl) AS net_trading_pnl,

        -- Settlement P&L (from holding)
        sum(settlement_value) AS total_settlement,
        sum(held_cost) AS total_held_cost,
        sum(settlement_value - held_cost) AS net_settlement_pnl,
        sumIf(settlement_value - held_cost, settlement_value > held_cost) AS settlement_gains,
        sumIf(settlement_value - held_cost, settlement_value < held_cost) AS settlement_losses,

        -- Combined
        sum(trading_pnl + settlement_value - held_cost) AS total_pnl
      FROM with_resolutions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POSITION CATEGORIES:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Positions with shares held:  ${parseInt(r.positions_with_shares)}`);
  console.log(`  Positions fully exited:      ${parseInt(r.positions_fully_exited)}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TRADING P&L (from selling shares):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Trading Gains:       $${parseFloat(r.trading_gains).toLocaleString()}`);
  console.log(`  Trading Losses:      $${parseFloat(r.trading_losses).toLocaleString()}`);
  console.log(`  Net Trading P&L:     $${parseFloat(r.net_trading_pnl).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SETTLEMENT P&L (from holding shares):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Settlement Value:    $${parseFloat(r.total_settlement).toLocaleString()}`);
  console.log(`  Held Cost:           $${parseFloat(r.total_held_cost).toLocaleString()}`);
  console.log(`  Net Settlement P&L:  $${parseFloat(r.net_settlement_pnl).toLocaleString()}`);
  console.log(`  Settlement Gains:    $${parseFloat(r.settlement_gains).toLocaleString()}`);
  console.log(`  Settlement Losses:   $${parseFloat(r.settlement_losses).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOTAL P&L:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total P&L:           $${parseFloat(r.total_pnl).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON WITH POLYMARKET:');
  console.log('═══════════════════════════════════════════════════════════════');

  const settlementGains = parseFloat(r.settlement_gains);
  const settlementLosses = Math.abs(parseFloat(r.settlement_losses));
  const settlementNet = parseFloat(r.net_settlement_pnl);

  const pmGains = 376597.39;
  const pmLosses = 190734.84;
  const pmNet = 184862.55;

  console.log('\nHYPOTHESIS: Polymarket only counts settlement P&L');
  console.log('');
  console.log('Settlement Gains:');
  console.log(`  Polymarket:  $${pmGains.toLocaleString()}`);
  console.log(`  Our calc:    $${settlementGains.toLocaleString()}`);
  console.log(`  Difference:  $${(settlementGains - pmGains).toLocaleString()}`);
  console.log(`  Match:       ${Math.abs(settlementGains - pmGains) < 50000 ? '✅' : '❌'}`);

  console.log('\nSettlement Losses:');
  console.log(`  Polymarket:  $${pmLosses.toLocaleString()}`);
  console.log(`  Our calc:    $${settlementLosses.toLocaleString()}`);
  console.log(`  Difference:  $${(settlementLosses - pmLosses).toLocaleString()}`);
  console.log(`  Match:       ${Math.abs(settlementLosses - pmLosses) < 50000 ? '✅' : '❌'}`);

  console.log('\nSettlement Net:');
  console.log(`  Polymarket:  $${pmNet.toLocaleString()}`);
  console.log(`  Our calc:    $${settlementNet.toLocaleString()}`);
  console.log(`  Difference:  $${(settlementNet - pmNet).toLocaleString()}`);
  console.log(`  Match:       ${Math.abs(settlementNet - pmNet) < 50000 ? '✅' : '❌'}`);
}

main().catch(console.error);
