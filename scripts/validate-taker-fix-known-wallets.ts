#!/usr/bin/env npx tsx
/**
 * Validate the taker-only fix using known wallets from the user's spreadsheet
 * These wallets have been manually verified against Polymarket UI
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Known wallets with manually verified Polymarket PnL values
const KNOWN_WALLETS = [
  { wallet: '0x2826c943697778f624cd46b6a488e8ee4fae3f4f', pmPnl: 633.20, name: 'Wallet 1 (from spreadsheet)' },
  { wallet: '0x97e1e8027dd31b5db1467bb870c4bc0d1637ae74', pmPnl: 27596, name: 'Wallet 2 (from spreadsheet)' },
];

async function calculatePnL(wallet: string, takerOnly: boolean): Promise<{ pnl: number; trades: number; markets: number }> {
  const takerFilter = takerOnly ? "AND event_id LIKE '%-t'" : '';

  const result = await clickhouse.query({
    query: `
      WITH
        filtered_events AS (
          SELECT event_id, side, usdc_amount, token_amount, token_id
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
            AND trader_wallet = '${wallet}'
            ${takerFilter}
        ),
        deduped_trades AS (
          SELECT event_id, any(side) AS side, any(usdc_amount) / 1000000.0 AS usdc, any(token_amount) / 1000000.0 AS tokens, any(token_id) AS token_id
          FROM filtered_events
          GROUP BY event_id
        ),
        trades_mapped AS (
          SELECT m.condition_id, m.outcome_index, d.side, d.usdc, d.tokens
          FROM deduped_trades d
          INNER JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
        ),
        positions AS (
          SELECT condition_id, outcome_index, sum(if(side = 'buy', -usdc, usdc)) AS cash_flow, sum(if(side = 'buy', tokens, -tokens)) AS shares
          FROM trades_mapped
          GROUP BY condition_id, outcome_index
        ),
        with_resolution AS (
          SELECT p.*,
            CASE WHEN r.payout_numerators IS NULL THEN 0 WHEN JSONExtractInt(r.payout_numerators, p.outcome_index + 1) >= 1000 THEN 1.0 ELSE toFloat64(JSONExtractInt(r.payout_numerators, p.outcome_index + 1)) END AS resolution_price
          FROM positions p
          LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
        )
      SELECT
        sum(cash_flow + (shares * resolution_price)) as total_pnl,
        (SELECT count(DISTINCT event_id) FROM deduped_trades) as trade_count,
        (SELECT count(DISTINCT condition_id) FROM positions) as market_count
      FROM with_resolution
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];
  return {
    pnl: rows[0]?.total_pnl || 0,
    trades: rows[0]?.trade_count || 0,
    markets: rows[0]?.market_count || 0,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('VALIDATING TAKER-ONLY FIX ON KNOWN WALLETS');
  console.log('='.repeat(100));
  console.log('\nThese wallets have manually verified Polymarket UI values.\n');

  console.log('Wallet'.padEnd(44) + '| PM (manual) | Old (all)  | New (taker) | Old Ratio | New Ratio');
  console.log('-'.repeat(110));

  let totalImprovement = 0;

  for (const w of KNOWN_WALLETS) {
    const oldCalc = await calculatePnL(w.wallet, false);
    const newCalc = await calculatePnL(w.wallet, true);

    const oldRatio = oldCalc.pnl / w.pmPnl;
    const newRatio = newCalc.pnl / w.pmPnl;

    const oldError = Math.abs(oldRatio - 1);
    const newError = Math.abs(newRatio - 1);
    const improvement = oldError - newError;
    totalImprovement += improvement;

    const pmStr = `$${w.pmPnl.toFixed(0)}`.padStart(11);
    const oldStr = `$${oldCalc.pnl.toFixed(0)}`.padStart(10);
    const newStr = `$${newCalc.pnl.toFixed(0)}`.padStart(11);
    const oldRatioStr = `${oldRatio.toFixed(2)}x`.padStart(9);
    const newRatioStr = `${newRatio.toFixed(2)}x`.padStart(9);

    console.log(`${w.wallet} | ${pmStr} | ${oldStr} | ${newStr} | ${oldRatioStr} | ${newRatioStr}`);
    console.log(`  ${w.name}`);
    console.log(`  Trades: ${newCalc.trades}, Markets: ${newCalc.markets}`);
    console.log('');
  }

  console.log('='.repeat(110));
  console.log('ANALYSIS');
  console.log('='.repeat(110));
  console.log(`\nExpected: New Ratio should be close to 1.00x`);
  console.log(`Old calculation was showing ~2x (double counting taker + maker fills)`);
  console.log(`New calculation filters to taker-only events`);

  // Add more wallets from our cohort that might be verifiable
  console.log('\n\nGetting 10 more random wallets from cohort to check pattern...\n');

  const moreQ = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl_usd
      FROM pm_cohort_pnl_active_v1
      WHERE realized_pnl_usd > 1000 AND realized_pnl_usd < 100000
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const moreWallets = await moreQ.json() as any[];

  console.log('Wallet'.padEnd(44) + '| Cohort PnL | New (taker) | Ratio');
  console.log('-'.repeat(80));

  for (const w of moreWallets) {
    const newCalc = await calculatePnL(w.wallet, true);
    const ratio = w.realized_pnl_usd / newCalc.pnl;

    const cohortStr = `$${w.realized_pnl_usd.toFixed(0)}`.padStart(10);
    const newStr = `$${newCalc.pnl.toFixed(0)}`.padStart(11);
    const ratioStr = `${ratio.toFixed(2)}x`.padStart(6);

    console.log(`${w.wallet} | ${cohortStr} | ${newStr} | ${ratioStr}`);
  }

  console.log('\nNote: Cohort PnL was calculated with the OLD (all events) method.');
  console.log('If ratio is ~2.00x, it confirms the double-counting bug.\n');

  await clickhouse.close();
}

main().catch(console.error);
