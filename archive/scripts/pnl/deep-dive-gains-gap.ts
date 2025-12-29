// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env tsx
/**
 * Deep Dive: Understanding the $96M vs $28.8M Gains Gap
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

async function main() {
  console.log('==============================================================================');
  console.log('        DEEP DIVE: Understanding the $96M vs $28.8M Gains Gap                 ');
  console.log('==============================================================================');

  // 1. Break down by event type
  console.log('
=== 1. PnL by Event Type (from ledger) ===');
  const byType = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as events,
        sum(cash_delta) as net_cash,
        sumIf(cash_delta, cash_delta > 0) as cash_in,
        sumIf(cash_delta, cash_delta < 0) as cash_out,
        sum(fee_usdc) as fees
      FROM vw_pm_ledger_test
      WHERE wallet_address = '${SPORTS_BETTOR}'
      GROUP BY event_type
    `,
    format: 'JSONEachRow',
  });
  const typeRows = await byType.json() as any[];
  console.log('Type          | Events   | Net Cash ($)       | Cash In ($)        | Cash Out ($)       | Fees ($)');
  console.log('-'.repeat(110));
  for (const r of typeRows) {
    console.log(
      `${String(r.event_type).padEnd(13)} | ${String(r.events).padStart(8)} | ${Number(r.net_cash).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)} | ${Number(r.cash_in).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)} | ${Number(r.cash_out).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)} | ${Number(r.fees).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}`
    );
  }

  // 2. Compare to Goldsky realized_pnl
  // Schema: position_id, proxy_wallet, condition_id, realized_pnl, unrealized_pnl, total_bought, total_sold
  console.log('
=== 2. Goldsky pm_user_positions Analysis ===');
  const goldsky = await clickhouse.query({
    query: `
      SELECT
        countIf(realized_pnl > 0) as winning_positions,
        countIf(realized_pnl = 0) as zero_pnl_positions,
        countIf(realized_pnl < 0) as negative_pnl_positions,
        sumIf(realized_pnl, realized_pnl > 0) / 1e6 as gains_usd,
        sumIf(realized_pnl, realized_pnl < 0) / 1e6 as losses_usd,
        sum(realized_pnl) / 1e6 as net_realized_pnl,
        sum(total_bought) / 1e6 as total_bought_usd,
        sum(total_sold) / 1e6 as total_sold_usd
      FROM pm_user_positions
      WHERE lower(proxy_wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const gs = (await goldsky.json())[0] as any;
  console.log(`  Winning positions:   ${gs.winning_positions}`);
  console.log(`  Zero PnL positions:  ${gs.zero_pnl_positions}`);
  console.log(`  Negative positions:  ${gs.negative_pnl_positions}`);
  console.log(`  Gains (realized_pnl > 0):  $${Number(gs.gains_usd).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Losses (realized_pnl < 0): $${Number(gs.losses_usd).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Net realized_pnl:         $${Number(gs.net_realized_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Total bought:             $${Number(gs.total_bought_usd).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Total sold:               $${Number(gs.total_sold_usd).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // 3. Goldsky realized_pnl = max(0, payout - cost_basis) analysis
  console.log('
=== 3. Key Insight: Goldsky realized_pnl = max(0, profit) ===');
  console.log('  Goldsky uses a non-negative PnL model:');
  console.log('  - Winners: realized_pnl = payout - cost_basis (positive)');
  console.log('  - Losers: realized_pnl = 0 (losses are CROPPED!)');
  console.log('  - This explains why Goldsky gains ($28.8M) matches UI target exactly!');

  // 4. Check V4 canonical breakdown
  console.log('
=== 4. V4 Canonical PnL Breakdown ===');
  const v4 = await clickhouse.query({
    query: `
      SELECT
        count() as positions,
        sum(total_pnl) as net_pnl,
        sum(trading_pnl) as trading_pnl,
        sum(resolution_pnl) as resolution_pnl,
        sumIf(total_pnl, total_pnl > 0) as v4_gains,
        sumIf(total_pnl, total_pnl < 0) as v4_losses
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const v4Data = (await v4.json())[0] as any;
  console.log(`  Positions:      ${v4Data.positions}`);
  console.log(`  Net PnL:        $${Number(v4Data.net_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Trading PnL:    $${Number(v4Data.trading_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Resolution PnL: $${Number(v4Data.resolution_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  V4 Gains (pnl > 0):   $${Number(v4Data.v4_gains).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  V4 Losses (pnl < 0):  $${Number(v4Data.v4_losses).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // 5. Key insight: What if UI Gains = resolution payout for winning positions only?
  console.log('
=== 5. KEY INSIGHT: Resolution-Only Gains ===');
  const resOnlyGains = await clickhouse.query({
    query: `
      SELECT
        sumIf(resolution_pnl, resolution_pnl > 0) as resolution_gains,
        sumIf(trading_pnl, trading_pnl > 0) as trading_gains,
        sumIf(total_pnl, total_pnl > 0) as total_gains
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const resGains = (await resOnlyGains.json())[0] as any;
  console.log(`  Resolution gains only:  $${Number(resGains.resolution_gains).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Trading gains only:     $${Number(resGains.trading_gains).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Total gains (combined): $${Number(resGains.total_gains).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  UI Target:              $28,812,489`);

  // 6. The missing $4.9M in losses - check if it's fees
  console.log('
=== 6. Missing $4.9M in Losses - Fees Check ===');
  const fees = await clickhouse.query({
    query: `
      SELECT
        sum(fee_usdc) as total_fees
      FROM vw_pm_ledger_test
      WHERE wallet_address = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const feeData = (await fees.json())[0] as any;
  const lossGap = 38833660 - 33927580;
  console.log(`  Total fees paid:    $${Number(feeData.total_fees).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Loss gap:           $${lossGap.toLocaleString()}`);
  console.log(`  Fees explain gap:   ${Math.abs(Number(feeData.total_fees) - lossGap) < 500000 ? 'Possibly' : 'Not quite'}`);

  // 7. Check Goldsky total_bought for losing positions (their definition of losses)
  console.log('
=== 7. Goldsky Loss Definition ===');
  const gsLosses = await clickhouse.query({
    query: `
      SELECT
        countIf(realized_pnl = 0) as zero_pnl_positions,
        sumIf(total_bought, realized_pnl = 0) / 1e6 as zero_pnl_bought,
        sumIf(total_bought, realized_pnl <= 0) / 1e6 as loser_total_bought
      FROM pm_user_positions
      WHERE lower(proxy_wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const gsLoss = (await gsLosses.json())[0] as any;
  console.log(`  Zero PnL positions:          ${gsLoss.zero_pnl_positions}`);
  console.log(`  Zero PnL total_bought:       $${Number(gsLoss.zero_pnl_bought).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  All losers total_bought:     $${Number(gsLoss.loser_total_bought).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  UI Target Losses:            $38,833,660`);

  // 8. Final hypothesis
  console.log('
=== 8. HYPOTHESIS ===');
  console.log(`
  UI Methodology (PolymarketAnalytics):

  GAINS = Goldsky realized_pnl WHERE realized_pnl > 0
        Match: $${Number(gs.gains_usd).toLocaleString(undefined, {maximumFractionDigits: 0})} vs $28.8M target

  LOSSES = total_bought for positions with realized_pnl <= 0
         = $${Number(gsLoss.loser_total_bought).toLocaleString(undefined, {maximumFractionDigits: 0})}
         Target: $38,833,660
  `);

  await clickhouse.close();
}

main().catch(console.error);
