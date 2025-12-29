#!/usr/bin/env npx tsx
/**
 * Benchmark Validation V2
 *
 * Fixed version that:
 * 1. Starts from benchmark wallets with non-zero UI PnL
 * 2. Classifies activity for each wallet
 * 3. Uses proper pass criteria (excludes $0 benchmarks)
 * 4. Reports by cohort
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

interface WalletActivity {
  clob_count: number;
  transfer_in_count: number;
  split_merge_count: number;
  redemption_total: number;
}

interface ValidationResult {
  wallet: string;
  uiPnl: number;
  ourPnl: number;
  delta: number;
  deltaPct: number;
  status: 'PASS' | 'FAIL' | 'NO_BENCHMARK';
  activity: WalletActivity;
}

// Batch classify wallets
async function batchClassifyWallets(wallets: string[]): Promise<Map<string, WalletActivity>> {
  const walletList = wallets.map(w => `'${w.toLowerCase()}'`).join(',');

  const [clobQ, redemptionQ, splitQ, transferQ] = await Promise.all([
    clickhouse.query({
      query: `
        SELECT lower(trader_wallet) as wallet, count() as cnt
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) IN (${walletList})
        GROUP BY lower(trader_wallet)
      `,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `
        SELECT wallet, sum(redemption_payout) as total
        FROM pm_redemption_payouts_agg
        WHERE lower(wallet) IN (${walletList})
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `
        SELECT lower(user_address) as wallet, count() as cnt
        FROM pm_ctf_events
        WHERE lower(user_address) IN (${walletList})
          AND event_type IN ('PositionSplit', 'PositionsMerge')
        GROUP BY lower(user_address)
      `,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `
        SELECT lower(to_address) as wallet, count() as cnt
        FROM pm_erc1155_transfers
        WHERE lower(to_address) IN (${walletList})
          AND lower(from_address) != '0x0000000000000000000000000000000000000000'
        GROUP BY lower(to_address)
      `,
      format: 'JSONEachRow'
    }),
  ]);

  const [clobRows, redemptionRows, splitRows, transferRows] = await Promise.all([
    clobQ.json() as Promise<any[]>,
    redemptionQ.json() as Promise<any[]>,
    splitQ.json() as Promise<any[]>,
    transferQ.json() as Promise<any[]>,
  ]);

  const clobMap = new Map(clobRows.map(r => [r.wallet.toLowerCase(), Number(r.cnt)]));
  const redemptionMap = new Map(redemptionRows.map(r => [(r.wallet || '').toLowerCase(), Number(r.total)]));
  const splitMap = new Map(splitRows.map(r => [r.wallet.toLowerCase(), Number(r.cnt)]));
  const transferMap = new Map(transferRows.map(r => [r.wallet.toLowerCase(), Number(r.cnt)]));

  const result = new Map<string, WalletActivity>();
  for (const w of wallets) {
    const wl = w.toLowerCase();
    result.set(wl, {
      clob_count: clobMap.get(wl) || 0,
      redemption_total: redemptionMap.get(wl) || 0,
      split_merge_count: splitMap.get(wl) || 0,
      transfer_in_count: transferMap.get(wl) || 0,
    });
  }
  return result;
}

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
  console.log('BENCHMARK VALIDATION V2');
  console.log('='.repeat(80));

  // Step 1: Get benchmark wallets with non-zero UI PnL
  const benchQ = await clickhouse.query({
    query: `
      SELECT wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      WHERE abs(pnl_value) > 0.01
      ORDER BY abs(pnl_value)
    `,
    format: 'JSONEachRow'
  });
  const benchRows = await benchQ.json() as Array<{ wallet: string; pnl_value: number }>;

  // Dedupe by lowercase wallet (keep largest abs pnl)
  const benchMap = new Map<string, { wallet: string; pnl: number }>();
  for (const r of benchRows) {
    const w = r.wallet.toLowerCase();
    const pnl = Number(r.pnl_value);
    if (!benchMap.has(w) || Math.abs(pnl) > Math.abs(benchMap.get(w)!.pnl)) {
      benchMap.set(w, { wallet: w, pnl });
    }
  }
  const benchmarks = Array.from(benchMap.values());
  console.log(`Loaded ${benchmarks.length} benchmark wallets with non-zero UI PnL\n`);

  // Step 2: Batch classify all wallets
  console.log('Classifying wallet activity...');
  const activityMap = await batchClassifyWallets(benchmarks.map(b => b.wallet));

  // Step 3: Calculate PnL for each wallet
  console.log('Calculating PnL for each wallet...\n');
  const results: ValidationResult[] = [];

  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    try {
      const pnl = await calculateWalletPnl(b.wallet);
      const activity = activityMap.get(b.wallet.toLowerCase())!;

      // Proper pass criteria
      const hasBenchmark = b.pnl !== null && Math.abs(b.pnl) > 0.01;
      let status: 'PASS' | 'FAIL' | 'NO_BENCHMARK';
      let delta = 0;
      let deltaPct = 0;

      if (!hasBenchmark) {
        status = 'NO_BENCHMARK';
      } else {
        delta = pnl.total - b.pnl;
        deltaPct = Math.abs(b.pnl) > 0 ? Math.abs(delta / b.pnl) * 100 : Infinity;
        // Pass if within 20% OR within $50
        status = (deltaPct <= 20 || Math.abs(delta) <= 50) ? 'PASS' : 'FAIL';
      }

      results.push({
        wallet: b.wallet,
        uiPnl: b.pnl,
        ourPnl: pnl.total,
        delta,
        deltaPct,
        status,
        activity,
      });

      if ((i + 1) % 10 === 0) {
        process.stdout.write(`Processed ${i + 1}/${benchmarks.length}\r`);
      }
    } catch (e: any) {
      console.log(`Error on ${b.wallet.slice(0, 20)}: ${e.message.slice(0, 50)}`);
    }
  }
  console.log(`\nProcessed ${results.length} wallets\n`);

  // Step 4: Calculate cohort statistics
  const cohorts = {
    'All wallets': results,
    'Has CLOB': results.filter(r => r.activity.clob_count > 0),
    'No transfers': results.filter(r => r.activity.transfer_in_count === 0),
    'No split/merge': results.filter(r => r.activity.split_merge_count === 0),
    'HC (CLOB + no xfr + no split)': results.filter(r =>
      r.activity.clob_count > 0 &&
      r.activity.transfer_in_count === 0 &&
      r.activity.split_merge_count === 0
    ),
    'Near-HC (<=5 xfr, no split)': results.filter(r =>
      r.activity.clob_count > 0 &&
      r.activity.transfer_in_count <= 5 &&
      r.activity.split_merge_count === 0
    ),
  };

  console.log('COHORT PASS RATES (20% or $50 tolerance):');
  console.log('-'.repeat(70));
  console.log('Cohort'.padEnd(40) + ' | Pass | Fail | Total | Rate');
  console.log('-'.repeat(70));
  for (const [name, cohort] of Object.entries(cohorts)) {
    const passed = cohort.filter(r => r.status === 'PASS').length;
    const failed = cohort.filter(r => r.status === 'FAIL').length;
    const total = cohort.length;
    const pct = total > 0 ? (passed / total * 100).toFixed(1) : '0.0';
    console.log(`${name.padEnd(40)} | ${passed.toString().padStart(4)} | ${failed.toString().padStart(4)} | ${total.toString().padStart(5)} | ${pct}%`);
  }

  // Step 5: Show HC cohort details
  const hcCohort = cohorts['HC (CLOB + no xfr + no split)'];
  console.log(`\n${'='.repeat(80)}`);
  console.log('HIGH-CONFIDENCE COHORT DETAILS:');
  console.log('-'.repeat(100));
  console.log('Wallet'.padEnd(44) + ' | Our PnL'.padStart(12) + ' | UI PnL'.padStart(12) + ' | Delta'.padStart(10) + ' | Δ%'.padStart(8) + ' | Status');
  console.log('-'.repeat(100));

  for (const r of hcCohort.sort((a, b) => Math.abs(a.deltaPct) - Math.abs(b.deltaPct))) {
    const statusIcon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    console.log(
      r.wallet.slice(0, 42).padEnd(44) + ' | ' +
      ('$' + r.ourPnl.toFixed(0)).padStart(11) + ' | ' +
      ('$' + r.uiPnl.toFixed(0)).padStart(11) + ' | ' +
      ('$' + r.delta.toFixed(0)).padStart(9) + ' | ' +
      (r.deltaPct.toFixed(1) + '%').padStart(7) + ' | ' +
      statusIcon
    );
  }

  // Step 6: Show top 20 failures
  const failures = results.filter(r => r.status === 'FAIL').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TOP 20 FAILURES (${failures.length} total):`);
  console.log('-'.repeat(110));
  console.log('Wallet'.padEnd(44) + ' | Our PnL'.padStart(12) + ' | UI PnL'.padStart(12) + ' | Delta'.padStart(10) + ' | Xfr'.padStart(5) + ' | Split'.padStart(6));
  console.log('-'.repeat(110));

  for (const f of failures.slice(0, 20)) {
    console.log(
      f.wallet.slice(0, 42).padEnd(44) + ' | ' +
      ('$' + f.ourPnl.toFixed(0)).padStart(11) + ' | ' +
      ('$' + f.uiPnl.toFixed(0)).padStart(11) + ' | ' +
      ('$' + f.delta.toFixed(0)).padStart(9) + ' | ' +
      f.activity.transfer_in_count.toString().padStart(4) + ' | ' +
      f.activity.split_merge_count.toString().padStart(5)
    );
  }

  // Step 7: Summary
  const totalPassed = results.filter(r => r.status === 'PASS').length;
  const totalFailed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY:');
  console.log(`  Total benchmarks validated: ${results.length}`);
  console.log(`  Passed (within 20% or $50): ${totalPassed} (${(totalPassed/results.length*100).toFixed(1)}%)`);
  console.log(`  Failed: ${totalFailed} (${(totalFailed/results.length*100).toFixed(1)}%)`);
  console.log(`  HC wallets available: ${hcCohort.length}`);
  console.log(`  HC pass rate: ${hcCohort.filter(r => r.status === 'PASS').length}/${hcCohort.length}`);

  await clickhouse.close();
}

main().catch(console.error);
