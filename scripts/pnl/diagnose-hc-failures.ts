#!/usr/bin/env npx tsx
/**
 * HC Benchmark Failure Taxonomy
 *
 * Diagnoses failures by category:
 * A) MAPPING_GAP - trades not mapping to condition/outcome
 * B) UNREALIZED_MISSING - open positions (engine is realized-only)
 * C) REDEMPTION_LOGIC - redemption calculation issues
 * D) OTHER
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

interface WalletDiagnostics {
  wallet: string;
  ui_pnl: number;
  our_total: number;
  our_trading: number;
  our_redemption: number;
  total_trades: number;
  mapped_trades: number;
  unmapped_trades: number;
  open_positions_count: number;
  has_redemptions: boolean;
  redemption_total: number;
  has_transfer: boolean;
  has_split_merge: boolean;
  delta: number;
  deltaPct: number;
  status: 'PASS' | 'FAIL';
  failure_bucket: 'MAPPING_GAP' | 'UNREALIZED_MISSING' | 'REDEMPTION_LOGIC' | 'OTHER' | 'N/A';
}

async function getWalletDiagnostics(wallet: string, uiPnl: number): Promise<WalletDiagnostics> {
  // 1. Total trades
  const totalQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_dedup_v2_tbl WHERE lower(trader_wallet) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const totalRows = await totalQ.json() as any[];
  const total_trades = Number(totalRows[0]?.cnt || 0);

  // 2. Mapped trades (with condition_id)
  const mappedQ = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trader_events_dedup_v2_tbl t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${wallet}')
        AND m.condition_id IS NOT NULL
    `,
    format: 'JSONEachRow'
  });
  const mappedRows = await mappedQ.json() as any[];
  const mapped_trades = Number(mappedRows[0]?.cnt || 0);

  // 3. Redemptions
  const redemptionQ = await clickhouse.query({
    query: `
      SELECT lower(condition_id) as cid, sum(redemption_payout) as payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
      GROUP BY lower(condition_id)
    `,
    format: 'JSONEachRow'
  });
  const redemptionRows = await redemptionQ.json() as any[];
  const redemptionsByCondition = new Map(redemptionRows.map((r: any) => [r.cid, Number(r.payout)]));
  const redemption_total = Array.from(redemptionsByCondition.values()).reduce((a, b) => a + b, 0);

  // 4. Transfers
  const transferQ = await clickhouse.query({
    query: `
      SELECT count() as cnt FROM pm_erc1155_transfers
      WHERE lower(to_address) = lower('${wallet}')
        AND lower(from_address) != '0x0000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  });
  const transferRows = await transferQ.json() as any[];
  const has_transfer = Number(transferRows[0]?.cnt || 0) > 0;

  // 5. Split/merge
  const splitQ = await clickhouse.query({
    query: `
      SELECT count() as cnt FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
        AND event_type IN ('PositionSplit', 'PositionsMerge')
    `,
    format: 'JSONEachRow'
  });
  const splitRows = await splitQ.json() as any[];
  const has_split_merge = Number(splitRows[0]?.cnt || 0) > 0;

  // 6. Calculate PnL and track positions
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
  let open_positions_count = 0;

  const conditionRemainingCost = new Map<string, bigint>();
  for (const [key, pos] of positions.entries()) {
    tradingPnl += pos.realizedPnl;
    if (pos.amount > 0n) open_positions_count++;
    const currentCost = conditionRemainingCost.get(pos.conditionId) || 0n;
    conditionRemainingCost.set(pos.conditionId, currentCost + pos.remainingCost);
  }

  for (const [cid, payout] of redemptionsByCondition.entries()) {
    const remainingCost = Number(conditionRemainingCost.get(cid) || 0n) / 1e6;
    redemptionPnl += payout - remainingCost;
  }

  const our_trading = Number(tradingPnl) / 1e6;
  const our_redemption = redemptionPnl;
  const our_total = our_trading + our_redemption;

  const delta = our_total - uiPnl;
  const deltaPct = Math.abs(uiPnl) > 0 ? Math.abs(delta / uiPnl) * 100 : (delta === 0 ? 0 : Infinity);
  const status = (deltaPct <= 20 || Math.abs(delta) <= 50) ? 'PASS' : 'FAIL';

  // Determine failure bucket
  let failure_bucket: WalletDiagnostics['failure_bucket'] = 'N/A';
  if (status === 'FAIL') {
    const unmapped_pct = total_trades > 0 ? (total_trades - mapped_trades) / total_trades : 0;
    if (mapped_trades === 0 || unmapped_pct > 0.05) {
      failure_bucket = 'MAPPING_GAP';
    } else if (open_positions_count > 0) {
      failure_bucket = 'UNREALIZED_MISSING';
    } else if (redemption_total > 0 && Math.abs(delta) > 100) {
      failure_bucket = 'REDEMPTION_LOGIC';
    } else {
      failure_bucket = 'OTHER';
    }
  }

  return {
    wallet,
    ui_pnl: uiPnl,
    our_total,
    our_trading,
    our_redemption,
    total_trades,
    mapped_trades,
    unmapped_trades: total_trades - mapped_trades,
    open_positions_count,
    has_redemptions: redemption_total > 0,
    redemption_total,
    has_transfer,
    has_split_merge,
    delta,
    deltaPct,
    status,
    failure_bucket,
  };
}

async function main() {
  console.log('HC BENCHMARK FAILURE TAXONOMY');
  console.log('='.repeat(100));

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
  console.log(`Analyzing ${benchmarks.length} HC benchmarks...\n`);

  const results: WalletDiagnostics[] = [];
  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    const diag = await getWalletDiagnostics(b.wallet, Number(b.pnl_value));
    results.push(diag);
    process.stdout.write(`Processed ${i + 1}/${benchmarks.length}\r`);
  }
  console.log('\n');

  // Print diagnostics table
  console.log('DIAGNOSTICS TABLE:');
  console.log('-'.repeat(180));
  console.log(
    'Wallet'.padEnd(20) +
    'UI PnL'.padStart(12) +
    'Our Tot'.padStart(12) +
    'Trading'.padStart(10) +
    'Redemp'.padStart(10) +
    'Trades'.padStart(7) +
    'Mapped'.padStart(7) +
    'Unmap'.padStart(6) +
    'Open'.padStart(5) +
    'HasRed'.padStart(7) +
    'Delta'.padStart(12) +
    'Δ%'.padStart(8) +
    'Status'.padStart(7) +
    'Bucket'.padStart(20)
  );
  console.log('-'.repeat(180));

  for (const r of results) {
    console.log(
      r.wallet.slice(0, 18).padEnd(20) +
      ('$' + r.ui_pnl.toFixed(0)).padStart(12) +
      ('$' + r.our_total.toFixed(0)).padStart(12) +
      ('$' + r.our_trading.toFixed(0)).padStart(10) +
      ('$' + r.our_redemption.toFixed(0)).padStart(10) +
      r.total_trades.toString().padStart(7) +
      r.mapped_trades.toString().padStart(7) +
      r.unmapped_trades.toString().padStart(6) +
      r.open_positions_count.toString().padStart(5) +
      (r.has_redemptions ? 'Y' : 'N').padStart(7) +
      ('$' + r.delta.toFixed(0)).padStart(12) +
      (r.deltaPct.toFixed(1) + '%').padStart(8) +
      r.status.padStart(7) +
      r.failure_bucket.padStart(20)
    );
  }

  // Bucket analysis
  console.log('\n' + '='.repeat(100));
  console.log('FAILURE BUCKETS:');
  console.log('-'.repeat(100));

  const buckets = {
    'MAPPING_GAP': results.filter(r => r.failure_bucket === 'MAPPING_GAP'),
    'UNREALIZED_MISSING': results.filter(r => r.failure_bucket === 'UNREALIZED_MISSING'),
    'REDEMPTION_LOGIC': results.filter(r => r.failure_bucket === 'REDEMPTION_LOGIC'),
    'OTHER': results.filter(r => r.failure_bucket === 'OTHER'),
  };

  for (const [bucket, wallets] of Object.entries(buckets)) {
    console.log(`\n${bucket}: ${wallets.length} wallets`);
    if (wallets.length > 0) {
      console.log('  Examples:');
      for (const w of wallets.slice(0, 3)) {
        console.log(`    ${w.wallet.slice(0, 20)}... UI=$${w.ui_pnl.toFixed(0)} Our=$${w.our_total.toFixed(0)} Delta=$${w.delta.toFixed(0)} Open=${w.open_positions_count} Red=${w.has_redemptions ? 'Y' : 'N'}`);
      }
    }
  }

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY:');
  console.log(`  Total: ${results.length} | Passed: ${passed} (${(passed/results.length*100).toFixed(1)}%) | Failed: ${failed}`);
  console.log(`  Bucket A (MAPPING_GAP): ${buckets.MAPPING_GAP.length}`);
  console.log(`  Bucket B (UNREALIZED_MISSING): ${buckets.UNREALIZED_MISSING.length}`);
  console.log(`  Bucket C (REDEMPTION_LOGIC): ${buckets.REDEMPTION_LOGIC.length}`);
  console.log(`  Bucket D (OTHER): ${buckets.OTHER.length}`);

  // Recommendation
  console.log('\n' + '='.repeat(100));
  console.log('RECOMMENDATION:');
  const dominant = Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)[0];
  if (dominant[1].length > 0) {
    console.log(`  Dominant failure bucket: ${dominant[0]} (${dominant[1].length} wallets)`);
    if (dominant[0] === 'MAPPING_GAP') {
      console.log('  ACTION: Fix mapping coverage or join key first');
    } else if (dominant[0] === 'UNREALIZED_MISSING') {
      console.log('  ACTION: Either filter to flat inventory (open_positions=0) OR add unrealized PnL module');
    } else if (dominant[0] === 'REDEMPTION_LOGIC') {
      console.log('  ACTION: Implement correct payout redemption handling');
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
