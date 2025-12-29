/**
 * Benchmark Cost Basis Engine WITH Redemption Adjustment
 *
 * Tests hypothesis: For high-redemption wallets missing external acquisitions,
 * adding redemption cashflows as an adjustment improves UI parity.
 *
 * Mode A: Maker-only cost basis (baseline)
 * Mode B: Baseline + redemption_usdc_total (adjusted)
 *
 * Key insight: Redemption USDC is NOT profit - it's full payout.
 * But for wallets missing cost basis (external acquisitions), this may
 * help close the gap.
 *
 * Run with: npx tsx scripts/pnl/benchmark-with-redemptions.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '../../lib/pnl/loadResolutionsStrict';
import { loadRedemptionsForWallets, WalletRedemptions } from '../../lib/pnl/loadRedemptions';

interface BenchmarkWallet {
  addr: string;
  uiPnl: number;
  benchmarkSet: string;
}

async function loadBenchmarks(client: any): Promise<BenchmarkWallet[]> {
  const result = await client.query({
    query: `
      WITH latest AS (
        SELECT wallet, max(captured_at) as latest_capture
        FROM pm_ui_pnl_benchmarks_v1
        GROUP BY wallet
      )
      SELECT b.wallet, b.pnl_value, b.benchmark_set
      FROM pm_ui_pnl_benchmarks_v1 b
      INNER JOIN latest l ON b.wallet = l.wallet AND b.captured_at = l.latest_capture
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    addr: r.wallet,
    uiPnl: Number(r.pnl_value),
    benchmarkSet: r.benchmark_set,
  }));
}

async function loadMakerTrades(client: any, wallet: string): Promise<any[]> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
          AND role = 'maker'
        GROUP BY event_id
      )
      SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

function computePnL(
  wallet: string,
  trades: any[],
  resolutions: Map<string, number>
): { realized: number; unrealized: number; external: number; positions: number } {
  const positions = new Map<string, Position>();
  let external = 0;

  for (const t of trades) {
    let pos = positions.get(t.token_id) || emptyPosition(wallet, t.token_id);
    const price = Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;

    if (t.side === 'buy') {
      pos = updateWithBuy(pos, Number(t.token_amount), price);
    } else {
      const { position: newPos, result } = updateWithSell(pos, Number(t.token_amount), price);
      pos = newPos;
      external += result.externalSell;
    }
    positions.set(t.token_id, pos);
  }

  let realized = 0;
  let unrealized = 0;
  for (const [tokenId, pos] of positions) {
    realized += pos.realizedPnl;
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && pos.amount > 0) {
      unrealized += pos.amount * (payout - pos.avgPrice);
    }
  }

  return { realized, unrealized, external, positions: positions.size };
}

interface WalletResult {
  wallet: string;
  uiPnl: number;
  baselinePnl: number;
  adjustedPnl: number;
  redemptionUsdc: number;
  redemptionCount: number;
  baselineErr: number;
  adjustedErr: number;
  improved: boolean;
}

async function main() {
  const client = getClickHouseClient();

  console.log('Loading benchmarks...');
  const wallets = await loadBenchmarks(client);
  console.log(`Loaded ${wallets.length} wallets`);

  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions`);

  console.log('Loading redemptions...');
  const redemptionMap = await loadRedemptionsForWallets(wallets.map((w) => w.addr));
  console.log(`Loaded redemptions for ${redemptionMap.size} wallets\n`);

  const results: WalletResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];

    try {
      const trades = await loadMakerTrades(client, w.addr);
      const pnl = computePnL(w.addr, trades, resolutions);
      const baselinePnl = pnl.realized + pnl.unrealized;

      // Get redemption data
      const redemption = redemptionMap.get(w.addr.toLowerCase());
      const redemptionUsdc = redemption?.usdcRedeemedTotal || 0;
      const redemptionCount = redemption?.redemptionCountTotal || 0;

      // Adjusted PnL: baseline + redemption cashflow
      // NOTE: This is a crude adjustment - redemption includes cost recovery too
      // A more sophisticated approach would estimate missing cost basis
      const adjustedPnl = baselinePnl + redemptionUsdc;

      const baselineErr = w.uiPnl !== 0 ? Math.abs((baselinePnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100 : 0;
      const adjustedErr = w.uiPnl !== 0 ? Math.abs((adjustedPnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100 : 0;

      results.push({
        wallet: w.addr,
        uiPnl: w.uiPnl,
        baselinePnl,
        adjustedPnl,
        redemptionUsdc,
        redemptionCount,
        baselineErr,
        adjustedErr,
        improved: adjustedErr < baselineErr,
      });
    } catch {
      continue;
    }

    if ((i + 1) % 20 === 0) {
      process.stdout.write(`\rProcessed ${i + 1}/${wallets.length}`);
    }
  }
  console.log('\n');

  // Summary statistics
  console.log('=== SUMMARY: BASELINE vs REDEMPTION-ADJUSTED ===\n');

  const thresholds = [1, 5, 10, 25, 50];
  console.log('| Threshold | Baseline | Adjusted | Delta |');
  console.log('|-----------|----------|----------|-------|');
  for (const t of thresholds) {
    const baselineWithin = results.filter((r) => r.baselineErr <= t).length;
    const adjustedWithin = results.filter((r) => r.adjustedErr <= t).length;
    const delta = adjustedWithin - baselineWithin;
    const sign = delta >= 0 ? '+' : '';
    console.log(
      `| ≤${t.toString().padStart(2)}% | ${baselineWithin.toString().padStart(3)}/${results.length} (${((baselineWithin / results.length) * 100).toFixed(0).padStart(2)}%) | ${adjustedWithin.toString().padStart(3)}/${results.length} (${((adjustedWithin / results.length) * 100).toFixed(0).padStart(2)}%) | ${sign}${delta} |`
    );
  }

  // Median errors
  const baselineMedian = results.map((r) => r.baselineErr).sort((a, b) => a - b)[Math.floor(results.length / 2)];
  const adjustedMedian = results.map((r) => r.adjustedErr).sort((a, b) => a - b)[Math.floor(results.length / 2)];
  console.log(`\nMedian error: Baseline=${baselineMedian.toFixed(1)}%, Adjusted=${adjustedMedian.toFixed(1)}%`);

  // Break down by redemption level
  console.log('\n\n=== BREAKDOWN BY REDEMPTION LEVEL ===\n');

  const noRedemption = results.filter((r) => r.redemptionCount === 0);
  const lowRedemption = results.filter((r) => r.redemptionCount > 0 && r.redemptionCount <= 10);
  const medRedemption = results.filter((r) => r.redemptionCount > 10 && r.redemptionCount <= 50);
  const highRedemption = results.filter((r) => r.redemptionCount > 50);

  const groups = [
    { name: 'No redemptions (0)', data: noRedemption },
    { name: 'Low (1-10)', data: lowRedemption },
    { name: 'Medium (11-50)', data: medRedemption },
    { name: 'High (51+)', data: highRedemption },
  ];

  console.log('| Group | Count | Baseline ≤10% | Adjusted ≤10% | Improved |');
  console.log('|-------|-------|---------------|---------------|----------|');
  for (const g of groups) {
    if (g.data.length === 0) continue;
    const baselineWithin10 = g.data.filter((r) => r.baselineErr <= 10).length;
    const adjustedWithin10 = g.data.filter((r) => r.adjustedErr <= 10).length;
    const improved = g.data.filter((r) => r.improved).length;
    console.log(
      `| ${g.name.padEnd(20)} | ${g.data.length.toString().padStart(3)} | ${((baselineWithin10 / g.data.length) * 100).toFixed(0).padStart(2)}% (${baselineWithin10}/${g.data.length}) | ${((adjustedWithin10 / g.data.length) * 100).toFixed(0).padStart(2)}% (${adjustedWithin10}/${g.data.length}) | ${((improved / g.data.length) * 100).toFixed(0)}% |`
    );
  }

  // Show wallets that improved significantly
  console.log('\n\n=== TOP 10 IMPROVED WALLETS ===\n');
  const improved = results
    .filter((r) => r.baselineErr > 25 && r.adjustedErr < r.baselineErr - 10)
    .sort((a, b) => (b.baselineErr - b.adjustedErr) - (a.baselineErr - a.adjustedErr));

  console.log('| Wallet | UI PnL | Redemptions | Baseline Err | Adjusted Err |');
  console.log('|--------|--------|-------------|--------------|--------------|');
  for (const r of improved.slice(0, 10)) {
    const ui = r.uiPnl >= 0 ? `$${(r.uiPnl / 1000).toFixed(0)}k` : `-$${(Math.abs(r.uiPnl) / 1000).toFixed(0)}k`;
    console.log(
      `| ${r.wallet.slice(0, 10)}.. | ${ui.padStart(7)} | ${r.redemptionCount.toString().padStart(5)} ($${(r.redemptionUsdc / 1000).toFixed(0)}k) | ${r.baselineErr.toFixed(0).padStart(10)}% | ${r.adjustedErr.toFixed(0).padStart(10)}% |`
    );
  }

  // Show wallets that got worse
  console.log('\n\n=== TOP 10 WORSENED WALLETS ===\n');
  const worsened = results
    .filter((r) => r.adjustedErr > r.baselineErr + 10)
    .sort((a, b) => (b.adjustedErr - b.baselineErr) - (a.adjustedErr - a.baselineErr));

  console.log('| Wallet | UI PnL | Redemptions | Baseline Err | Adjusted Err |');
  console.log('|--------|--------|-------------|--------------|--------------|');
  for (const r of worsened.slice(0, 10)) {
    const ui = r.uiPnl >= 0 ? `$${(r.uiPnl / 1000).toFixed(0)}k` : `-$${(Math.abs(r.uiPnl) / 1000).toFixed(0)}k`;
    console.log(
      `| ${r.wallet.slice(0, 10)}.. | ${ui.padStart(7)} | ${r.redemptionCount.toString().padStart(5)} ($${(r.redemptionUsdc / 1000).toFixed(0)}k) | ${r.baselineErr.toFixed(0).padStart(10)}% | ${r.adjustedErr.toFixed(0).padStart(10)}% |`
    );
  }

  // Key insight
  console.log('\n\n=== KEY INSIGHT ===\n');
  const improvedCount = results.filter((r) => r.improved).length;
  const worsenedCount = results.filter((r) => !r.improved && r.adjustedErr > r.baselineErr).length;
  console.log(`Improved: ${improvedCount}/${results.length} (${((improvedCount / results.length) * 100).toFixed(0)}%)`);
  console.log(`Worsened: ${worsenedCount}/${results.length} (${((worsenedCount / results.length) * 100).toFixed(0)}%)`);
  console.log(`Same: ${results.length - improvedCount - worsenedCount}/${results.length}`);

  if (improvedCount > worsenedCount) {
    console.log('\n✅ Redemption adjustment helps overall');
  } else {
    console.log('\n❌ Redemption adjustment hurts overall - need smarter approach');
  }
}

main().catch(console.error);
