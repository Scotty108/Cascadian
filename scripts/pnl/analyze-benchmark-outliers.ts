/**
 * Comprehensive Benchmark Outlier Analysis
 *
 * Per GPT recommendation:
 * - Outputs machine-readable JSON with per-wallet features
 * - Computes thresholds: 1/5/10/25/50%
 * - Clusters outliers by failure mode
 * - Recommends Playwright sample set
 *
 * Run with: npx tsx scripts/pnl/analyze-benchmark-outliers.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import * as fs from 'fs';

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '../../lib/pnl/loadResolutionsStrict';

interface WalletResult {
  wallet: string;
  benchmark_set: string;
  captured_at: string;
  ui_pnl: number;
  engine_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  abs_error_pct: number;
  abs_error_usd: number;
  error_pct: number;
  // Trading shape
  maker_trade_count: number;
  taker_trade_count: number;
  maker_ratio: number;
  external_sell_tokens: number;
  position_count: number;
  // CTF behavior
  payout_redemption_count: number;
  position_split_count: number;
  position_merge_count: number;
  // Data completeness
  clob_first_ts: string;
  clob_last_ts: string;
  ctf_first_ts: string;
  ctf_last_ts: string;
  // Flags
  is_tiny: boolean; // ui_abs < $200
  is_taker_heavy: boolean; // maker_ratio < 50%
  is_high_external_sells: boolean; // external_sell_tokens > 10% of total buys
  is_high_redemptions: boolean; // redemption_count > 10
  cluster: string; // Classification
}

async function loadBenchmarks(client: any): Promise<any[]> {
  const result = await client.query({
    query: `
      WITH latest AS (
        SELECT wallet, max(captured_at) as latest_capture
        FROM pm_ui_pnl_benchmarks_v1
        GROUP BY wallet
      )
      SELECT
        b.wallet,
        b.pnl_value as ui_pnl,
        b.benchmark_set,
        b.captured_at
      FROM pm_ui_pnl_benchmarks_v1 b
      INNER JOIN latest l ON b.wallet = l.wallet AND b.captured_at = l.latest_capture
      ORDER BY abs(b.pnl_value) DESC
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

async function getTradeShape(client: any, wallet: string): Promise<{
  maker: number;
  taker: number;
  clob_first: string;
  clob_last: string;
}> {
  const result = await client.query({
    query: `
      SELECT
        countDistinctIf(event_id, role = 'maker') as maker,
        countDistinctIf(event_id, role = 'taker') as taker,
        min(trade_time) as first_ts,
        max(trade_time) as last_ts
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return {
    maker: Number(rows[0].maker),
    taker: Number(rows[0].taker),
    clob_first: rows[0].first_ts || '',
    clob_last: rows[0].last_ts || '',
  };
}

async function getCTFStats(client: any, wallet: string): Promise<{
  redemptions: number;
  splits: number;
  merges: number;
  first_ts: string;
  last_ts: string;
}> {
  const result = await client.query({
    query: `
      SELECT
        countIf(event_type = 'PayoutRedemption') as redemptions,
        countIf(event_type = 'PositionSplit') as splits,
        countIf(event_type = 'PositionMerge') as merges,
        min(event_timestamp) as first_ts,
        max(event_timestamp) as last_ts
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}') AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return {
    redemptions: Number(rows[0].redemptions),
    splits: Number(rows[0].splits),
    merges: Number(rows[0].merges),
    first_ts: rows[0].first_ts || '',
    last_ts: rows[0].last_ts || '',
  };
}

async function loadMakerTrades(client: any, wallet: string): Promise<any[]> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(token_id) as token_id, any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0 AND role = 'maker'
        GROUP BY event_id
      ) SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

function computePnL(
  wallet: string,
  trades: any[],
  resolutions: Map<string, number>
): {
  realized: number;
  unrealized: number;
  external_sells: number;
  position_count: number;
} {
  const positions = new Map<string, Position>();
  let external_sells = 0;

  for (const t of trades) {
    let pos = positions.get(t.token_id) || emptyPosition(wallet, t.token_id);
    const price = Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;

    if (t.side === 'buy') {
      pos = updateWithBuy(pos, Number(t.token_amount), price);
    } else {
      const { position: newPos, result } = updateWithSell(pos, Number(t.token_amount), price);
      pos = newPos;
      external_sells += result.externalSell;
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

  return { realized, unrealized, external_sells, position_count: positions.size };
}

function classifyWallet(r: WalletResult): string {
  if (r.is_tiny) return 'tiny';
  if (r.is_high_redemptions) return 'high_redemptions';
  if (r.is_high_external_sells) return 'high_external_sells';
  if (r.is_taker_heavy) return 'taker_heavy';
  return 'normal';
}

async function main() {
  const client = getClickHouseClient();

  console.log('Loading benchmarks...');
  const benchmarks = await loadBenchmarks(client);
  console.log(`Loaded ${benchmarks.length} benchmark wallets`);

  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  const results: WalletResult[] = [];

  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];

    // Load all data for this wallet
    let trades: any[] = [];
    try {
      trades = await loadMakerTrades(client, b.wallet);
    } catch {
      console.log(`Failed to load trades for ${b.wallet.slice(0, 10)}`);
      continue;
    }

    const tradeShape = await getTradeShape(client, b.wallet);
    const ctfStats = await getCTFStats(client, b.wallet);
    const pnl = computePnL(b.wallet, trades, resolutions);

    const engine_pnl = pnl.realized + pnl.unrealized;
    const ui_pnl = Number(b.ui_pnl);
    const error = engine_pnl - ui_pnl;
    const error_pct = ui_pnl !== 0 ? (error / Math.abs(ui_pnl)) * 100 : 0;

    const maker_ratio = tradeShape.maker + tradeShape.taker > 0
      ? tradeShape.maker / (tradeShape.maker + tradeShape.taker)
      : 0;

    // Tiny: absolute UI PnL < $200
    const is_tiny = Math.abs(ui_pnl) < 200;
    // Taker-heavy: maker ratio < 50%
    const is_taker_heavy = maker_ratio < 0.5;
    // High external sells: > 1000 tokens (arbitrary threshold, can adjust)
    const is_high_external_sells = pnl.external_sells > 1000;
    // High redemptions: > 10 redemption events
    const is_high_redemptions = ctfStats.redemptions > 10;

    const row: WalletResult = {
      wallet: b.wallet,
      benchmark_set: b.benchmark_set,
      captured_at: b.captured_at,
      ui_pnl,
      engine_pnl,
      realized_pnl: pnl.realized,
      unrealized_pnl: pnl.unrealized,
      abs_error_pct: Math.abs(error_pct),
      abs_error_usd: Math.abs(error),
      error_pct,
      maker_trade_count: tradeShape.maker,
      taker_trade_count: tradeShape.taker,
      maker_ratio,
      external_sell_tokens: pnl.external_sells,
      position_count: pnl.position_count,
      payout_redemption_count: ctfStats.redemptions,
      position_split_count: ctfStats.splits,
      position_merge_count: ctfStats.merges,
      clob_first_ts: tradeShape.clob_first,
      clob_last_ts: tradeShape.clob_last,
      ctf_first_ts: ctfStats.first_ts,
      ctf_last_ts: ctfStats.last_ts,
      is_tiny,
      is_taker_heavy,
      is_high_external_sells,
      is_high_redemptions,
      cluster: '',
    };
    row.cluster = classifyWallet(row);
    results.push(row);

    if ((i + 1) % 20 === 0) {
      process.stdout.write(`\rProcessed ${i + 1}/${benchmarks.length}`);
    }

    // Rate limiting
    if (i % 20 === 0 && i > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  console.log('\n');

  // Write JSON output
  const outputPath = '/tmp/benchmark_outliers_133.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`Wrote JSON output to: ${outputPath}\n`);

  // === THRESHOLD ANALYSIS ===
  console.log('=== ERROR THRESHOLD ANALYSIS ===\n');
  const thresholds = [1, 5, 10, 25, 50];
  for (const t of thresholds) {
    const within = results.filter((r) => r.abs_error_pct <= t).length;
    console.log(`Within ${t}%: ${within}/${results.length} (${((within / results.length) * 100).toFixed(1)}%)`);
  }

  // Excluding tiny wallets
  const nonTiny = results.filter((r) => !r.is_tiny);
  console.log(`\nExcluding tiny wallets (${results.length - nonTiny.length} excluded):`);
  for (const t of thresholds) {
    const within = nonTiny.filter((r) => r.abs_error_pct <= t).length;
    console.log(`Within ${t}%: ${within}/${nonTiny.length} (${((within / nonTiny.length) * 100).toFixed(1)}%)`);
  }

  // === TOP OUTLIERS BY PCT ===
  console.log('\n\n=== TOP 20 OUTLIERS BY PERCENT ERROR ===\n');
  const byPct = [...results].sort((a, b) => b.abs_error_pct - a.abs_error_pct);
  console.log('| Wallet | UI | Engine | Error% | Cluster | MakerRatio | Redemptions |');
  console.log('|--------|-----|--------|--------|---------|------------|-------------|');
  for (const r of byPct.slice(0, 20)) {
    const ui = `$${(r.ui_pnl / 1000).toFixed(1)}k`;
    const eng = `$${(r.engine_pnl / 1000).toFixed(1)}k`;
    console.log(
      `| ${r.wallet.slice(0, 8)}.. | ${ui.padStart(6)} | ${eng.padStart(7)} | ${r.error_pct.toFixed(0).padStart(6)}% | ${r.cluster.padEnd(9)} | ${(r.maker_ratio * 100).toFixed(0).padStart(10)}% | ${r.payout_redemption_count.toString().padStart(11)} |`
    );
  }

  // === TOP OUTLIERS BY USD ===
  console.log('\n\n=== TOP 20 OUTLIERS BY ABSOLUTE USD ERROR ===\n');
  const byUsd = [...results].sort((a, b) => b.abs_error_usd - a.abs_error_usd);
  console.log('| Wallet | UI | Engine | Error$ | Cluster | MakerRatio | Redemptions |');
  console.log('|--------|-----|--------|--------|---------|------------|-------------|');
  for (const r of byUsd.slice(0, 20)) {
    const ui = `$${(r.ui_pnl / 1000).toFixed(1)}k`;
    const eng = `$${(r.engine_pnl / 1000).toFixed(1)}k`;
    const err = `$${(r.abs_error_usd / 1000).toFixed(1)}k`;
    console.log(
      `| ${r.wallet.slice(0, 8)}.. | ${ui.padStart(6)} | ${eng.padStart(7)} | ${err.padStart(7)} | ${r.cluster.padEnd(9)} | ${(r.maker_ratio * 100).toFixed(0).padStart(10)}% | ${r.payout_redemption_count.toString().padStart(11)} |`
    );
  }

  // === CLUSTER ANALYSIS ===
  console.log('\n\n=== CLUSTER ANALYSIS ===\n');
  const clusters = new Map<string, WalletResult[]>();
  for (const r of results) {
    const arr = clusters.get(r.cluster) || [];
    arr.push(r);
    clusters.set(r.cluster, arr);
  }

  for (const [cluster, members] of clusters) {
    const within10 = members.filter((r) => r.abs_error_pct <= 10).length;
    const within25 = members.filter((r) => r.abs_error_pct <= 25).length;
    const medianErr = members.map((r) => r.abs_error_pct).sort((a, b) => a - b)[Math.floor(members.length / 2)] || 0;
    console.log(`${cluster}: ${members.length} wallets`);
    console.log(`  ≤10%: ${within10}/${members.length}, ≤25%: ${within25}/${members.length}, Median: ${medianErr.toFixed(1)}%`);
  }

  // === PLAYWRIGHT SAMPLE SET ===
  console.log('\n\n=== RECOMMENDED PLAYWRIGHT SAMPLE SET ===\n');
  console.log('Based on GPT guidance: 3-5 wallets per cluster for investigation\n');

  // Get outliers only (> 25% error)
  const outliers = results.filter((r) => r.abs_error_pct > 25);

  const sampleSet: { wallet: string; cluster: string; error_pct: number; ui_pnl: number }[] = [];

  const clusterSamples: Record<string, number> = {
    tiny: 3,
    taker_heavy: 3,
    high_external_sells: 3,
    high_redemptions: 3,
    normal: 3,
  };

  for (const [cluster, limit] of Object.entries(clusterSamples)) {
    const clusterOutliers = outliers.filter((r) => r.cluster === cluster)
      .sort((a, b) => b.abs_error_usd - a.abs_error_usd); // Sort by USD error

    for (const o of clusterOutliers.slice(0, limit)) {
      sampleSet.push({
        wallet: o.wallet,
        cluster: o.cluster,
        error_pct: o.error_pct,
        ui_pnl: o.ui_pnl,
      });
    }
  }

  console.log('Wallets to investigate with Playwright:\n');
  for (const s of sampleSet) {
    console.log(`  ${s.cluster.padEnd(18)} ${s.wallet} (UI: $${(s.ui_pnl / 1000).toFixed(1)}k, err: ${s.error_pct.toFixed(0)}%)`);
  }

  console.log(`\nTotal sample set: ${sampleSet.length} wallets`);
  console.log('\nWallet addresses for Playwright:');
  for (const s of sampleSet) {
    console.log(s.wallet);
  }
}

main().catch(console.error);
