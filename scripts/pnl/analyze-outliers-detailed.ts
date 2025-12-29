/**
 * Detailed analysis of outlier wallets from benchmark
 *
 * Run with: npx tsx scripts/pnl/analyze-outliers-detailed.ts
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

interface BenchmarkWallet {
  addr: string;
  uiPnl: number;
  benchmarkSet: string;
  capturedAt: string;
}

interface WalletAnalysis {
  wallet: string;
  uiPnl: number;
  enginePnl: number;
  errorPct: number;
  benchmarkSet: string;
  capturedAt: string;
  // Breakdown
  makerTrades: number;
  takerTrades: number;
  totalTrades: number;
  positions: number;
  realizedPnl: number;
  unrealizedPnl: number;
  externalSells: number;
  // Flags
  hasTakerActivity: boolean;
  hasRedemptions: number;
  hasSplits: number;
  makerPct: number;
}

async function loadAllBenchmarkWallets(client: any): Promise<BenchmarkWallet[]> {
  const result = await client.query({
    query: `
      WITH latest AS (
        SELECT wallet, max(captured_at) as latest_capture
        FROM pm_ui_pnl_benchmarks_v1
        GROUP BY wallet
      )
      SELECT
        b.wallet,
        b.pnl_value,
        b.benchmark_set,
        b.captured_at
      FROM pm_ui_pnl_benchmarks_v1 b
      INNER JOIN latest l ON b.wallet = l.wallet AND b.captured_at = l.latest_capture
      ORDER BY b.pnl_value DESC
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    addr: r.wallet,
    uiPnl: Number(r.pnl_value),
    benchmarkSet: r.benchmark_set,
    capturedAt: r.captured_at,
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

async function getTradeBreakdown(client: any, wallet: string): Promise<{ maker: number; taker: number }> {
  const result = await client.query({
    query: `
      SELECT
        countDistinctIf(event_id, role = 'maker') as maker,
        countDistinctIf(event_id, role = 'taker') as taker
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return { maker: Number(rows[0].maker), taker: Number(rows[0].taker) };
}

async function getCTFActivity(client: any, wallet: string): Promise<{ redemptions: number; splits: number }> {
  const result = await client.query({
    query: `
      SELECT
        countIf(event_type = 'PayoutRedemption') as redemptions,
        countIf(event_type = 'PositionSplit') as splits
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}') AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return { redemptions: Number(rows[0].redemptions), splits: Number(rows[0].splits) };
}

function processWallet(
  wallet: string,
  trades: any[],
  resolutions: Map<string, number>
): {
  totalRealized: number;
  totalUnrealized: number;
  totalExternal: number;
  positionCount: number;
} {
  const positions = new Map<string, Position>();
  let totalExternal = 0;

  for (const t of trades) {
    const tokenId = t.token_id;
    let position = positions.get(tokenId) || emptyPosition(wallet, tokenId);
    const price =
      Number(t.token_amount) > 0
        ? Number(t.usdc_amount) / Number(t.token_amount)
        : 0;

    if (t.side === 'buy') {
      position = updateWithBuy(position, Number(t.token_amount), price);
    } else {
      const { position: newPos, result } = updateWithSell(
        position,
        Number(t.token_amount),
        price
      );
      position = newPos;
      totalExternal += result.externalSell;
    }
    positions.set(tokenId, position);
  }

  let totalRealized = 0;
  let totalUnrealized = 0;

  for (const [tokenId, pos] of positions) {
    totalRealized += pos.realizedPnl;
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && pos.amount > 0) {
      totalUnrealized += pos.amount * (payout - pos.avgPrice);
    }
  }

  return {
    totalRealized,
    totalUnrealized,
    totalExternal,
    positionCount: positions.size,
  };
}

async function main() {
  const client = getClickHouseClient();

  console.log('Loading benchmark wallets...');
  const wallets = await loadAllBenchmarkWallets(client);
  console.log(`Loaded ${wallets.length} wallets`);

  console.log('Loading resolutions...');
  const { resolutions, stats } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  const results: WalletAnalysis[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];

    let trades: any[] = [];
    try {
      trades = await loadMakerTrades(client, w.addr);
    } catch (err) {
      console.log(`Failed to load trades for ${w.addr.slice(0, 10)}`);
      continue;
    }

    const processed = processWallet(w.addr, trades, resolutions);
    const breakdown = await getTradeBreakdown(client, w.addr);
    const ctf = await getCTFActivity(client, w.addr);

    const totalPnl = processed.totalRealized + processed.totalUnrealized;
    const errorPct = w.uiPnl !== 0 ? ((totalPnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100 : 0;

    results.push({
      wallet: w.addr,
      uiPnl: w.uiPnl,
      enginePnl: totalPnl,
      errorPct,
      benchmarkSet: w.benchmarkSet,
      capturedAt: w.capturedAt,
      makerTrades: breakdown.maker,
      takerTrades: breakdown.taker,
      totalTrades: breakdown.maker + breakdown.taker,
      positions: processed.positionCount,
      realizedPnl: processed.totalRealized,
      unrealizedPnl: processed.totalUnrealized,
      externalSells: processed.totalExternal,
      hasTakerActivity: breakdown.taker > 0,
      hasRedemptions: ctf.redemptions,
      hasSplits: ctf.splits,
      makerPct: breakdown.maker > 0 ? (breakdown.maker / (breakdown.maker + breakdown.taker)) * 100 : 0,
    });

    if ((i + 1) % 20 === 0) {
      process.stdout.write(`\rProcessed ${i + 1}/${wallets.length}`);
    }
  }
  console.log('\n');

  // Error threshold analysis
  const thresholds = [1, 5, 10, 25, 50, 100];
  console.log('=== ERROR THRESHOLD ANALYSIS ===\n');
  for (const t of thresholds) {
    const within = results.filter((r) => Math.abs(r.errorPct) <= t).length;
    console.log(`Within ${t}%: ${within}/${results.length} (${((within / results.length) * 100).toFixed(1)}%)`);
  }

  // Outliers analysis (> 25% error)
  const outliers = results.filter((r) => Math.abs(r.errorPct) > 25);
  console.log(`\n\n=== OUTLIERS (> 25% error): ${outliers.length} wallets ===\n`);

  // Sort by absolute error
  outliers.sort((a, b) => Math.abs(b.errorPct) - Math.abs(a.errorPct));

  console.log('| Wallet | UI PnL | Engine | Error | Maker% | Taker | Redemptions | Set |');
  console.log('|--------|--------|--------|-------|--------|-------|-------------|-----|');
  for (const o of outliers) {
    const ui = o.uiPnl >= 0 ? `$${(o.uiPnl / 1000).toFixed(1)}k` : `-$${(Math.abs(o.uiPnl) / 1000).toFixed(1)}k`;
    const eng = o.enginePnl >= 0 ? `$${(o.enginePnl / 1000).toFixed(1)}k` : `-$${(Math.abs(o.enginePnl) / 1000).toFixed(1)}k`;
    console.log(
      `| ${o.wallet.slice(0, 8)}.. | ${ui.padStart(8)} | ${eng.padStart(8)} | ${o.errorPct.toFixed(0).padStart(5)}% | ${o.makerPct.toFixed(0).padStart(4)}% | ${o.takerTrades.toString().padStart(5)} | ${o.hasRedemptions.toString().padStart(11)} | ${o.benchmarkSet.slice(0, 10)} |`
    );
  }

  // Pattern analysis
  console.log('\n\n=== PATTERN ANALYSIS ===\n');

  const takerHeavy = outliers.filter((o) => o.makerPct < 50);
  const withRedemptions = outliers.filter((o) => o.hasRedemptions > 0);
  const withSplits = outliers.filter((o) => o.hasSplits > 0);
  const legacySet = outliers.filter((o) => o.benchmarkSet.includes('legacy'));
  const engineZero = outliers.filter((o) => Math.abs(o.enginePnl) < 100 && Math.abs(o.uiPnl) > 1000);
  const negativeError = outliers.filter((o) => o.errorPct < -25); // Engine too low

  console.log(`Taker-heavy (<50% maker): ${takerHeavy.length}/${outliers.length}`);
  console.log(`With redemptions: ${withRedemptions.length}/${outliers.length}`);
  console.log(`With splits: ${withSplits.length}/${outliers.length}`);
  console.log(`Legacy benchmark set: ${legacySet.length}/${outliers.length}`);
  console.log(`Engine ~$0 but UI > $1k: ${engineZero.length}/${outliers.length}`);
  console.log(`Negative error (engine too low): ${negativeError.length}/${outliers.length}`);

  // List engine-zero cases
  if (engineZero.length > 0) {
    console.log('\n--- Wallets where engine = ~$0 but UI > $1k ---');
    for (const e of engineZero) {
      console.log(`  ${e.wallet.slice(0, 12)}.. UI: $${(e.uiPnl / 1000).toFixed(1)}k, Engine: $${(e.enginePnl / 1000).toFixed(1)}k, Maker: ${e.makerTrades}, Taker: ${e.takerTrades}`);
    }
  }

  // List taker-heavy cases
  if (takerHeavy.length > 0) {
    console.log('\n--- Taker-heavy outliers ---');
    for (const t of takerHeavy) {
      console.log(`  ${t.wallet.slice(0, 12)}.. Maker: ${t.makerPct.toFixed(0)}%, UI: $${(t.uiPnl / 1000).toFixed(1)}k, Engine: $${(t.enginePnl / 1000).toFixed(1)}k`);
    }
  }
}

main().catch(console.error);
