#!/usr/bin/env npx tsx
/**
 * Batch Validation Engine V1
 *
 * Efficiently validates PnL for all benchmark wallets with:
 * - Batch activity classification
 * - High-confidence cohort filtering
 * - Per GPT advice: exclude transfers/split-merge for accurate results
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

// Batch classify all wallets
async function batchClassifyWallets(wallets: string[]): Promise<Map<string, any>> {
  const walletList = wallets.map(w => `'${w.toLowerCase()}'`).join(',');

  const [clobQ, redemptionQ, splitQ, transferQ] = await Promise.all([
    // CLOB activity
    clickhouse.query({
      query: `
        SELECT lower(trader_wallet) as wallet, count() as cnt
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) IN (${walletList})
        GROUP BY lower(trader_wallet)
      `,
      format: 'JSONEachRow'
    }),
    // Redemption totals
    clickhouse.query({
      query: `
        SELECT wallet as wallet, sum(redemption_payout) as total
        FROM pm_redemption_payouts_agg
        WHERE lower(wallet) IN (${walletList})
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    }),
    // Split/merge activity
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
    // ERC1155 transfers IN
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

  // Build maps (lowercase all wallet addresses)
  const clobMap = new Map(clobRows.map(r => [r.wallet.toLowerCase(), Number(r.cnt)]));
  const redemptionMap = new Map(redemptionRows.map(r => [r.wallet.toLowerCase(), Number(r.total)]));
  const splitMap = new Map(splitRows.map(r => [r.wallet.toLowerCase(), Number(r.cnt)]));
  const transferMap = new Map(transferRows.map(r => [r.wallet.toLowerCase(), Number(r.cnt)]));

  // Combine into activity flags per wallet
  const result = new Map<string, any>();
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
  console.log('BATCH VALIDATION ENGINE V1');
  console.log('='.repeat(80));

  // Get benchmarks
  const benchQ = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      WHERE abs(pnl_value) > 0.1 AND abs(pnl_value) < 50000
      ORDER BY abs(pnl_value)
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });
  const benchmarks = await benchQ.json() as Array<{ wallet: string; pnl_value: number }>;
  console.log(`Loaded ${benchmarks.length} benchmark wallets\n`);

  // Batch classify all wallets
  console.log('Classifying wallet activity...');
  const activityMap = await batchClassifyWallets(benchmarks.map(b => b.wallet));

  // Process each wallet
  console.log('Calculating PnL for each wallet...\n');

  const results: Array<{
    wallet: string;
    uiPnl: number;
    ourPnl: number;
    delta: number;
    isPass: boolean;
    activity: any;
  }> = [];

  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    try {
      const pnl = await calculateWalletPnl(b.wallet);
      const activity = activityMap.get(b.wallet.toLowerCase())!;
      const delta = pnl.total - b.pnl_value;
      const deltaPct = Math.abs(b.pnl_value) > 0 ? Math.abs(delta / b.pnl_value) * 100 : 0;
      const isPass = deltaPct <= 20 || Math.abs(delta) <= 50;

      results.push({
        wallet: b.wallet,
        uiPnl: b.pnl_value,
        ourPnl: pnl.total,
        delta,
        isPass,
        activity,
      });

      // Progress indicator
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`Processed ${i + 1}/${benchmarks.length}\r`);
      }
    } catch (e: any) {
      console.log(`Error on ${b.wallet.slice(0, 20)}: ${e.message.slice(0, 40)}`);
    }
  }
  console.log(`\nProcessed ${results.length} wallets\n`);

  // Calculate cohort statistics
  const cohorts = {
    'All wallets': results,
    'Has CLOB': results.filter(r => r.activity.clob_count > 0),
    'No transfers': results.filter(r => r.activity.transfer_in_count === 0),
    'No split/merge': results.filter(r => r.activity.split_merge_count === 0),
    'CLOB + no transfers': results.filter(r => r.activity.clob_count > 0 && r.activity.transfer_in_count === 0),
    'CLOB + no xfr + no split': results.filter(r =>
      r.activity.clob_count > 0 &&
      r.activity.transfer_in_count === 0 &&
      r.activity.split_merge_count === 0
    ),
    'CLOB + no xfr + no split + rdm<100': results.filter(r =>
      r.activity.clob_count > 0 &&
      r.activity.transfer_in_count === 0 &&
      r.activity.split_merge_count === 0 &&
      r.activity.redemption_total < 100
    ),
  };

  console.log('COHORT PASS RATES (20% or $50 tolerance):');
  console.log('-'.repeat(60));
  for (const [name, cohort] of Object.entries(cohorts)) {
    const passed = cohort.filter(r => r.isPass).length;
    const pct = cohort.length > 0 ? (passed / cohort.length * 100).toFixed(1) : '0.0';
    console.log(`${name.padEnd(35)}: ${passed}/${cohort.length} (${pct}%)`);
  }

  // Show best cohort details
  const bestCohort = cohorts['CLOB + no xfr + no split'];
  console.log(`\n${'='.repeat(80)}`);
  console.log('HIGH-CONFIDENCE COHORT (CLOB + no transfers + no split/merge):');
  console.log('-'.repeat(80));
  console.log('Wallet                                     | Our PnL   | UI PnL    | Delta     | Status');
  console.log('-'.repeat(80));

  for (const r of bestCohort.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))) {
    console.log(
      r.wallet.slice(0, 42) + ' | ' +
      ('$' + r.ourPnl.toFixed(0)).padStart(9) + ' | ' +
      ('$' + r.uiPnl.toFixed(0)).padStart(9) + ' | ' +
      ('$' + r.delta.toFixed(0)).padStart(9) + ' | ' +
      (r.isPass ? '✅' : '❌')
    );
  }

  // Show failures
  const failures = bestCohort.filter(r => !r.isPass);
  if (failures.length > 0) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) {
      const deltaPct = Math.abs(f.uiPnl) > 0 ? Math.abs(f.delta / f.uiPnl) * 100 : 0;
      console.log(`  ${f.wallet}: Δ=$${f.delta.toFixed(0)} (${deltaPct.toFixed(1)}%)`);
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
