#!/usr/bin/env npx tsx
/**
 * Validate HC Benchmarks
 *
 * Runs PnL calculation against freshly scraped HC wallet benchmarks
 * and reports pass/fail rates.
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

const COLLATERAL_SCALE = 1_000_000n;

// Get redemptions per condition for a wallet
async function getRedemptionsByCondition(wallet: string): Promise<Map<string, number>> {
  const q = await clickhouse.query({
    query: `
      SELECT lower(condition_id) as cid, sum(redemption_payout) as payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
      GROUP BY lower(condition_id)
    `,
    format: 'JSONEachRow'
  });
  const rows = await q.json() as any[];
  return new Map(rows.map(r => [r.cid, Number(r.payout)]));
}

// Calculate PnL for a single wallet
async function calculateWalletPnl(wallet: string): Promise<{ trading: number; redemption: number; total: number }> {
  const redemptionsByCondition = await getRedemptionsByCondition(wallet);

  const tradesQ = await clickhouse.query({
    query: `
      SELECT m.condition_id, m.outcome_index, t.side, t.token_amount, t.usdc_amount
      FROM pm_trader_events_dedup_v2_tbl t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${wallet}')
      ORDER BY m.condition_id, m.outcome_index, t.trade_time
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQ.json() as any[];

  // Build positions with avg-cost tracking
  const positions = new Map<string, { amount: bigint; avgPrice: bigint; realizedPnl: bigint; conditionId: string; remainingCost: bigint }>();

  for (const t of trades) {
    if (!t.condition_id) continue;
    const key = t.condition_id.toLowerCase() + '_' + t.outcome_index;
    const cid = t.condition_id.toLowerCase();
    let pos = positions.get(key) || { amount: 0n, avgPrice: 0n, realizedPnl: 0n, conditionId: cid, remainingCost: 0n };

    const tokenAmt = BigInt(Math.round(Number(t.token_amount)));
    const usdcAmt = BigInt(Math.round(Number(t.usdc_amount)));
    const price = tokenAmt > 0n ? (usdcAmt * COLLATERAL_SCALE) / tokenAmt : 0n;

    if (t.side === 'buy') {
      if (pos.amount === 0n) pos.avgPrice = price;
      else if (tokenAmt > 0n) pos.avgPrice = (pos.avgPrice * pos.amount + price * tokenAmt) / (pos.amount + tokenAmt);
      pos.amount += tokenAmt;
      pos.remainingCost += usdcAmt;
    } else {
      const adj = tokenAmt > pos.amount ? pos.amount : tokenAmt;
      if (adj > 0n) {
        pos.realizedPnl += (adj * (price - pos.avgPrice)) / COLLATERAL_SCALE;
        if (pos.amount > 0n) pos.remainingCost = pos.remainingCost * (pos.amount - adj) / pos.amount;
        pos.amount -= adj;
      }
    }
    positions.set(key, pos);
  }

  // Calculate totals
  let tradingPnl = 0n;
  let redemptionPnl = 0;

  const conditionRemainingCost = new Map<string, bigint>();
  for (const [key, pos] of positions.entries()) {
    tradingPnl += pos.realizedPnl;
    const currentCost = conditionRemainingCost.get(pos.conditionId) || 0n;
    conditionRemainingCost.set(pos.conditionId, currentCost + pos.remainingCost);
  }

  // Redemption PnL = payout - remaining cost for redeemed conditions
  for (const [cid, payout] of redemptionsByCondition.entries()) {
    const remainingCost = Number(conditionRemainingCost.get(cid) || 0n) / 1e6;
    redemptionPnl += payout - remainingCost;
  }

  return {
    trading: Number(tradingPnl) / 1e6,
    redemption: redemptionPnl,
    total: Number(tradingPnl) / 1e6 + redemptionPnl,
  };
}

async function main() {
  console.log('HC BENCHMARK VALIDATION');
  console.log('='.repeat(80));

  // Get HC benchmarks
  const benchQ = await clickhouse.query({
    query: `
      SELECT wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = 'hc_playwright_2025_12_13'
    `,
    format: 'JSONEachRow'
  });
  const benchmarks = await benchQ.json() as Array<{ wallet: string; pnl_value: number }>;
  console.log(`Loaded ${benchmarks.length} HC benchmarks\n`);

  // Validate each
  const results: Array<{
    wallet: string;
    uiPnl: number;
    ourPnl: number;
    delta: number;
    deltaPct: number;
    status: 'PASS' | 'FAIL';
  }> = [];

  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    try {
      const pnl = await calculateWalletPnl(b.wallet);
      const delta = pnl.total - b.pnl_value;
      const deltaPct = Math.abs(b.pnl_value) > 0 ? Math.abs(delta / b.pnl_value) * 100 : (delta === 0 ? 0 : Infinity);

      // Pass if within 20% OR within $50
      const status = (deltaPct <= 20 || Math.abs(delta) <= 50) ? 'PASS' : 'FAIL';

      results.push({
        wallet: b.wallet,
        uiPnl: b.pnl_value,
        ourPnl: pnl.total,
        delta,
        deltaPct,
        status,
      });

      if ((i + 1) % 5 === 0) {
        process.stdout.write(`Processed ${i + 1}/${benchmarks.length}\r`);
      }
    } catch (e: any) {
      console.log(`Error on ${b.wallet.slice(0, 20)}: ${e.message.slice(0, 50)}`);
    }
  }
  console.log(`\nProcessed ${results.length} wallets\n`);

  // Results table
  console.log('VALIDATION RESULTS:');
  console.log('-'.repeat(110));
  console.log('Wallet'.padEnd(44) + ' | UI PnL'.padStart(12) + ' | Our PnL'.padStart(12) + ' | Delta'.padStart(10) + ' | Δ%'.padStart(8) + ' | Status');
  console.log('-'.repeat(110));

  for (const r of results.sort((a, b) => Math.abs(a.deltaPct) - Math.abs(b.deltaPct))) {
    const statusIcon = r.status === 'PASS' ? '✅' : '❌';
    console.log(
      r.wallet.slice(0, 42).padEnd(44) + ' | ' +
      ('$' + r.uiPnl.toFixed(2)).padStart(11) + ' | ' +
      ('$' + r.ourPnl.toFixed(2)).padStart(11) + ' | ' +
      ('$' + r.delta.toFixed(2)).padStart(9) + ' | ' +
      (r.deltaPct.toFixed(1) + '%').padStart(7) + ' | ' +
      statusIcon
    );
  }

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const passRate = (passed / results.length * 100).toFixed(1);

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log(`  Total HC benchmarks validated: ${results.length}`);
  console.log(`  Passed (within 20% or $50): ${passed} (${passRate}%)`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Pass Rate: ${passRate}%`);

  await clickhouse.close();
}

main().catch(console.error);
