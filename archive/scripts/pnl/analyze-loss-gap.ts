// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env tsx
/**
 * Analyze the $4.9M Loss Gap
 *
 * Our L1/L4 = $33.9M vs UI Target = $38.8M
 * Gap = $4.9M
 *
 * Claude 1 - PnL Calibration
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const SPORTS_BETTOR = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';
const UI_TARGET_LOSSES = 38_833_660;
const OUR_L4_LOSSES = 33_927_580;
const GAP = UI_TARGET_LOSSES - OUR_L4_LOSSES; // ~4.9M

async function main() {
  console.log('==============================================================================');
  console.log('        ANALYZE THE $4.9M LOSS GAP                                            ');
  console.log('==============================================================================');
  console.log(`  UI Target Losses:  $${UI_TARGET_LOSSES.toLocaleString()}`);
  console.log(`  Our L4 Losses:     $${OUR_L4_LOSSES.toLocaleString()}`);
  console.log(`  Gap:               $${GAP.toLocaleString()}`);

  // 1. Check for missing resolutions (unresolved positions)
  console.log('
=== 1. Unresolved Positions Analysis ===');
  const unresolved = await clickhouse.query({
    query: `
      WITH resolved AS (
        SELECT DISTINCT condition_id FROM pm_condition_resolutions
      )
      SELECT
        count() as total_v4_positions,
        countIf(condition_id IN (SELECT condition_id FROM resolved)) as resolved_positions,
        countIf(condition_id NOT IN (SELECT condition_id FROM resolved)) as unresolved_positions,
        sumIf(total_pnl, condition_id NOT IN (SELECT condition_id FROM resolved)) as unresolved_pnl
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const ur = (await unresolved.json())[0] as any;
  console.log(`  Total V4 positions:   ${ur.total_v4_positions}`);
  console.log(`  Resolved positions:   ${ur.resolved_positions}`);
  console.log(`  Unresolved positions: ${ur.unresolved_positions}`);
  console.log(`  Unresolved PnL:       $${Number(ur.unresolved_pnl || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // 2. Check fees in trader events
  console.log('
=== 2. Trading Fees Analysis ===');
  const fees = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        sum(fee_amount) as total_fees_usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const f = (await fees.json())[0] as any;
  console.log(`  Total trades:    ${f.total_trades}`);
  console.log(`  Total fees:      $${Number(f.total_fees_usdc || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Gap ($4.9M) explained by fees: ${Math.abs(Number(f.total_fees_usdc || 0) - GAP) < 500000 ? 'POSSIBLY!' : 'No'}`);

  // 3. Aggregate at condition level (how UI might do it)
  console.log('
=== 3. Condition-Level Loss Aggregation ===');
  const condLoss = await clickhouse.query({
    query: `
      SELECT
        count() as conditions,
        -sumIf(cond_pnl, cond_pnl < 0) as loss_amount
      FROM (
        SELECT condition_id, sum(total_pnl) as cond_pnl
        FROM pm_wallet_market_pnl_v4
        WHERE lower(wallet) = '${SPORTS_BETTOR}'
        GROUP BY condition_id
      )
    `,
    format: 'JSONEachRow',
  });
  const cl = (await condLoss.json())[0] as any;
  console.log(`  Conditions with net loss: ${cl.conditions}`);
  console.log(`  Condition-level losses:   $${Number(cl.loss_amount).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // 4. Check trade event totals directly
  console.log('
=== 4. Trade Event Totals (Direct) ===');
  const tradeVsV4 = await clickhouse.query({
    query: `
      SELECT
        count() as total_events,
        sumIf(usdc_amount, side = 'BUY') as total_buy_usdc,
        sumIf(usdc_amount, side = 'SELL') as total_sell_usdc,
        sum(usdc_amount) as net_usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const tv = (await tradeVsV4.json())[0] as any;
  console.log(`  Total events:   ${tv.total_events}`);
  console.log(`  Buy USDC:       $${Number(tv.total_buy_usdc || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Sell USDC:      $${Number(tv.total_sell_usdc || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Net USDC:       $${Number(tv.net_usdc || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // 5. Calculate losses WITH fees included (potential UI methodology)
  console.log('
=== 5. Losses Including Trading Fees ===');
  const withFees = await clickhouse.query({
    query: `
      SELECT
        sum(trading_pnl) as trading_pnl,
        sum(resolution_pnl) as resolution_pnl,
        sum(total_pnl) as total_pnl,
        sumIf(total_pnl, total_pnl < 0) as losses_from_pnl
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const wf = (await withFees.json())[0] as any;
  const totalFees = Number(f.total_fees_usdc || 0);
  const lossesWithFees = Math.abs(Number(wf.losses_from_pnl)) + totalFees;
  console.log(`  V4 Losses (pnl < 0):     $${Math.abs(Number(wf.losses_from_pnl)).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Total Trading Fees:       $${totalFees.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Losses + Fees:            $${lossesWithFees.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  UI Target:                $${UI_TARGET_LOSSES.toLocaleString()}`);
  console.log(`  Match:                    ${Math.abs(lossesWithFees - UI_TARGET_LOSSES) < 500000 ? 'CLOSE!' : 'Not quite'}`);

  // 6. Alternative: Cost basis on losing positions
  console.log('
=== 6. Cost Basis Analysis on Losers ===');
  const costBasis = await clickhouse.query({
    query: `
      SELECT
        -sumIf(cash_delta, share_delta > 0) as total_cost_in,
        sumIf(cash_delta, share_delta < 0) as total_cash_out,
        -sumIf(cash_delta, share_delta > 0) - sumIf(cash_delta, share_delta < 0) as implied_loss
      FROM vw_pm_ledger_test
      WHERE wallet_address = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const cb = (await costBasis.json())[0] as any;
  console.log(`  Total cost in (buys):   $${Number(cb.total_cost_in).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Total cash out (sells): $${Number(cb.total_cash_out).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Net (cost - cash):      $${Number(cb.implied_loss).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // 7. Summary
  console.log('
=== 7. SUMMARY ===');
  console.log(`
  Our L4 (realized negative PnL):    $33,927,580
  Trading Fees:                      $${totalFees.toLocaleString(undefined, {maximumFractionDigits: 0})}
  L4 + Fees:                         $${(OUR_L4_LOSSES + totalFees).toLocaleString(undefined, {maximumFractionDigits: 0})}
  UI Target:                         $38,833,660

  If fees explain the gap, UI methodology is:
    UI_Losses = sum(|negative PnL|) + sum(trading fees)
  `);

  await clickhouse.close();
}

main().catch(console.error);
