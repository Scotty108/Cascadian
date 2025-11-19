#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Sampling winning positions to understand P&L calculation...\n`);

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
          t.net_shares * payout_per_share AS settlement_value,
          t.proceeds_sell - t.cost_buy AS trade_pnl,
          (t.net_shares * payout_per_share) + t.proceeds_sell - t.cost_buy AS total_pnl
        FROM trades_by_market t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
        WHERE r.winning_outcome IS NOT NULL
      )
      SELECT
        cid,
        outcome_idx,
        shares_buy,
        shares_sell,
        net_shares,
        cost_buy,
        proceeds_sell,
        settlement_value,
        trade_pnl,
        total_pnl,
        payout_per_share
      FROM with_resolutions
      WHERE total_pnl > 0
      ORDER BY total_pnl DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const positions = await result.json<Array<any>>();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOP 10 WINNING POSITIONS:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  let totalTradePnl = 0;
  let totalSettlement = 0;
  let totalPnl = 0;

  positions.forEach((p, i) => {
    const tradePnl = parseFloat(p.trade_pnl);
    const settlement = parseFloat(p.settlement_value);
    const total = parseFloat(p.total_pnl);
    const netShares = parseFloat(p.net_shares);
    const payout = parseFloat(p.payout_per_share);

    totalTradePnl += tradePnl;
    totalSettlement += settlement;
    totalPnl += total;

    console.log(`Position ${i + 1}:`);
    console.log(`  Buy:  ${parseFloat(p.shares_buy).toFixed(2)} shares for $${parseFloat(p.cost_buy).toFixed(2)}`);
    console.log(`  Sell: ${parseFloat(p.shares_sell).toFixed(2)} shares for $${parseFloat(p.proceeds_sell).toFixed(2)}`);
    console.log(`  Net:  ${netShares.toFixed(2)} shares @ ${payout.toFixed(4)} payout`);
    console.log(`  Trade P&L:      $${tradePnl.toFixed(2)} (proceeds - cost)`);
    console.log(`  Settlement:     $${settlement.toFixed(2)} (net_shares * payout)`);
    console.log(`  Total P&L:      $${total.toFixed(2)}`);
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOP 10 SUMMARY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Trade P&L:      $${totalTradePnl.toFixed(2)}`);
  console.log(`  Settlement:     $${totalSettlement.toFixed(2)}`);
  console.log(`  Total P&L:      $${totalPnl.toFixed(2)}`);
  console.log('');

  console.log('💡 HYPOTHESIS:');
  console.log('   If Polymarket only counts settlement value (not trading gains),');
  console.log('   then position P&L should be:');
  console.log(`   - For CLOSED positions (net_shares = 0): $0 settlement`);
  console.log(`   - For OPEN positions (net_shares > 0): net_shares * payout`);
  console.log('');
  console.log('   But we\'re adding BOTH trade_pnl AND settlement_value,');
  console.log('   which double-counts profits from positions that were:');
  console.log('   1. Bought low, sold high (trade_pnl)');
  console.log('   2. Then held some shares that won (settlement)');
}

main().catch(console.error);
