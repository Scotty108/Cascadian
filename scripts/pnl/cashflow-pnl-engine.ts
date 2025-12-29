#!/usr/bin/env npx tsx
/**
 * Cash-Flow PnL Engine
 *
 * Calculates PnL using a simple cash-flow approach:
 * Total PnL = -buy_cost + sell_proceeds + redemption_proceeds
 *
 * This avoids position tracking complexity by just summing:
 * - Money out (buying shares)
 * - Money in (selling shares + redemptions)
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

interface CashFlowResult {
  wallet: string;
  // CLOB activity
  buy_cost: number;
  sell_proceeds: number;
  clob_net: number;
  // Redemptions
  redemption_proceeds: number;
  redemption_count: number;
  // Total
  total_pnl: number;
  // Counts
  buy_count: number;
  sell_count: number;
}

async function calculateWalletPnl(wallet: string): Promise<CashFlowResult> {
  // Get CLOB trades (deduped by fill_key)
  const clobQ = await clickhouse.query({
    query: `
      SELECT
        sumIf(usdc_amount, side='buy') as buy_cost,
        sumIf(usdc_amount, side='sell') as sell_proceeds,
        countIf(side='buy') as buy_count,
        countIf(side='sell') as sell_count
      FROM (
        SELECT side, usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY transaction_hash, lower(trader_wallet), token_id, side, usdc_amount, token_amount
      )
    `,
    format: 'JSONEachRow'
  });
  const clobResult = await clobQ.json() as any[];
  const clob = clobResult[0] || { buy_cost: 0, sell_proceeds: 0, buy_count: 0, sell_count: 0 };

  // Get PayoutRedemptions
  const redemptionQ = await clickhouse.query({
    query: `
      SELECT
        sum(toFloat64(amount_or_payout)) as total_payout,
        count() as redemption_count
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
        AND event_type = 'PayoutRedemption'
    `,
    format: 'JSONEachRow'
  });
  const redemptionResult = await redemptionQ.json() as any[];
  const redemption = redemptionResult[0] || { total_payout: 0, redemption_count: 0 };

  const buyCost = Number(clob.buy_cost || 0) / 1e6;
  const sellProceeds = Number(clob.sell_proceeds || 0) / 1e6;
  const redemptionProceeds = Number(redemption.total_payout || 0) / 1e6;

  const clobNet = sellProceeds - buyCost;
  const totalPnl = clobNet + redemptionProceeds;

  return {
    wallet,
    buy_cost: buyCost,
    sell_proceeds: sellProceeds,
    clob_net: clobNet,
    redemption_proceeds: redemptionProceeds,
    redemption_count: Number(redemption.redemption_count || 0),
    total_pnl: totalPnl,
    buy_count: Number(clob.buy_count || 0),
    sell_count: Number(clob.sell_count || 0),
  };
}

async function main() {
  const wallet = process.argv[2];

  if (!wallet) {
    console.log('Usage: npx tsx cashflow-pnl-engine.ts <wallet>');
    console.log('       npx tsx cashflow-pnl-engine.ts --benchmark');
    process.exit(1);
  }

  if (wallet === '--benchmark') {
    // Run against benchmark wallets
    const benchQ = await clickhouse.query({
      query: `
        SELECT wallet, pnl_value
        FROM pm_ui_pnl_benchmarks_v1
        WHERE abs(pnl_value) < 10000 AND pnl_value != 0
        LIMIT 30
      `,
      format: 'JSONEachRow'
    });
    const benchmarks = await benchQ.json() as Array<{ wallet: string; pnl_value: number }>;

    console.log('='.repeat(130));
    console.log('CASH-FLOW PNL ENGINE - BENCHMARK VALIDATION');
    console.log('='.repeat(130));
    console.log('Wallet                                     | Buys | Sells | Buy Cost  | Sell $    | CLOB Net  | Redemptions | Total     | UI Target | Delta     | Status');
    console.log('-'.repeat(130));

    let passed = 0;
    let failed = 0;

    for (const b of benchmarks) {
      const result = await calculateWalletPnl(b.wallet);
      const delta = result.total_pnl - b.pnl_value;
      const deltaPercent = Math.abs(b.pnl_value) > 0 ? Math.abs(delta / b.pnl_value) * 100 : 0;

      // Pass if within 20% or $50 absolute
      const isPass = deltaPercent <= 20 || Math.abs(delta) <= 50;
      if (isPass) passed++;
      else failed++;

      const status = isPass ? '✅' : '❌';

      console.log(
        b.wallet.slice(0, 42) + ' | ' +
        String(result.buy_count).padStart(4) + ' | ' +
        String(result.sell_count).padStart(5) + ' | ' +
        ('$' + result.buy_cost.toFixed(0)).padStart(9) + ' | ' +
        ('$' + result.sell_proceeds.toFixed(0)).padStart(9) + ' | ' +
        ('$' + result.clob_net.toFixed(0)).padStart(9) + ' | ' +
        ('$' + result.redemption_proceeds.toFixed(0)).padStart(11) + ' | ' +
        ('$' + result.total_pnl.toFixed(0)).padStart(9) + ' | ' +
        ('$' + b.pnl_value.toFixed(0)).padStart(9) + ' | ' +
        ('$' + delta.toFixed(0)).padStart(9) + ' | ' +
        status
      );
    }

    console.log('-'.repeat(130));
    console.log('RESULT: ' + passed + '/' + (passed + failed) + ' (' + ((passed / (passed + failed)) * 100).toFixed(1) + '%) within tolerance');
    console.log('Tolerance: 20% or $50 absolute');

  } else {
    // Single wallet
    const result = await calculateWalletPnl(wallet);

    // Get benchmark if exists
    const benchQ = await clickhouse.query({
      query: `SELECT pnl_value FROM pm_ui_pnl_benchmarks_v1 WHERE lower(wallet) = lower('${wallet}') LIMIT 1`,
      format: 'JSONEachRow'
    });
    const bench = await benchQ.json() as Array<{ pnl_value: number }>;
    const uiPnl = bench.length > 0 ? bench[0].pnl_value : null;

    console.log('='.repeat(80));
    console.log('CASH-FLOW PNL ENGINE');
    console.log('Wallet: ' + wallet);
    console.log('='.repeat(80));
    console.log('\nCLOB ACTIVITY:');
    console.log('  Buy transactions:    ' + result.buy_count);
    console.log('  Sell transactions:   ' + result.sell_count);
    console.log('  Buy cost:            $' + result.buy_cost.toFixed(2));
    console.log('  Sell proceeds:       $' + result.sell_proceeds.toFixed(2));
    console.log('  CLOB Net:            $' + result.clob_net.toFixed(2));
    console.log('\nREDEMPTIONS:');
    console.log('  Redemption count:    ' + result.redemption_count);
    console.log('  Redemption proceeds: $' + result.redemption_proceeds.toFixed(2));
    console.log('\n' + '='.repeat(80));
    console.log('TOTAL PNL:             $' + result.total_pnl.toFixed(2));
    console.log('  (= CLOB Net + Redemptions)');

    if (uiPnl !== null) {
      const delta = result.total_pnl - uiPnl;
      const deltaPercent = Math.abs(uiPnl) > 0 ? (delta / Math.abs(uiPnl)) * 100 : 0;
      console.log('\n' + '='.repeat(80));
      console.log('COMPARISON TO UI:');
      console.log('  Our Total:   $' + result.total_pnl.toFixed(2));
      console.log('  UI Target:   $' + uiPnl.toFixed(2));
      console.log('  Delta:       $' + delta.toFixed(2) + ' (' + deltaPercent.toFixed(1) + '%)');
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
