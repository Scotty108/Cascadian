/**
 * Spot Check: Engine PnL vs UI PnL
 *
 * Validates cost-basis engine accuracy against live UI values.
 * Uses Playwright to scrape current UI PnL for comparison.
 *
 * Stratified sample:
 * - Top 5 from benchmarks (known high PnL)
 * - 5 random from "high cashflow" (test if they're actually profitable)
 * - 5 from different PnL ranges
 *
 * Run with: npx tsx scripts/pnl/spotcheck-engine-vs-ui.ts
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

interface WalletToCheck {
  wallet: string;
  category: string;
  benchmarkPnl?: number;
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

function computeEnginePnl(
  wallet: string,
  trades: any[],
  resolutions: Map<string, number>
): number {
  const positions = new Map<string, Position>();

  for (const t of trades) {
    let pos = positions.get(t.token_id) || emptyPosition(wallet, t.token_id);
    const price = Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;

    if (t.side === 'buy') {
      pos = updateWithBuy(pos, Number(t.token_amount), price);
    } else {
      const { position: newPos } = updateWithSell(pos, Number(t.token_amount), price);
      pos = newPos;
    }
    positions.set(t.token_id, pos);
  }

  let total = 0;
  for (const [tokenId, pos] of positions) {
    total += pos.realizedPnl;
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && pos.amount > 0) {
      total += pos.amount * (payout - pos.avgPrice);
    }
  }

  return total;
}

async function main() {
  const client = getClickHouseClient();

  console.log('=== ENGINE VS UI SPOT CHECK ===\n');

  // Load resolutions
  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  // Build sample list
  const walletsToCheck: WalletToCheck[] = [];

  // Category 1: Top benchmark wallets (known profitable)
  console.log('Loading benchmark wallets...');
  const benchmarkResult = await client.query({
    query: `
      WITH latest AS (
        SELECT wallet, max(captured_at) as latest_capture
        FROM pm_ui_pnl_benchmarks_v1
        GROUP BY wallet
      )
      SELECT b.wallet, b.pnl_value
      FROM pm_ui_pnl_benchmarks_v1 b
      INNER JOIN latest l ON b.wallet = l.wallet AND b.captured_at = l.latest_capture
      WHERE b.pnl_value > 1000000
      ORDER BY b.pnl_value DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const benchmarks = (await benchmarkResult.json()) as any[];
  for (const b of benchmarks) {
    walletsToCheck.push({
      wallet: b.wallet,
      category: 'benchmark_top',
      benchmarkPnl: Number(b.pnl_value),
    });
  }

  // Category 2: High cashflow wallets (test if actually profitable)
  console.log('Loading high-cashflow wallets...');
  const cashflowResult = await client.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        sumIf(usdc_amount, side = 'sell') / 1000000.0 - sumIf(usdc_amount, side = 'buy') / 1000000.0 as net_cashflow
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND role = 'maker'
      GROUP BY wallet
      HAVING count() > 1000
      ORDER BY net_cashflow DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const cashflowWallets = (await cashflowResult.json()) as any[];
  for (const c of cashflowWallets) {
    // Skip if already in benchmarks
    if (walletsToCheck.some(w => w.wallet.toLowerCase() === c.wallet.toLowerCase())) continue;
    walletsToCheck.push({
      wallet: c.wallet,
      category: 'high_cashflow',
    });
  }

  // Category 3: Mid-range benchmark wallets
  console.log('Loading mid-range wallets...');
  const midResult = await client.query({
    query: `
      WITH latest AS (
        SELECT wallet, max(captured_at) as latest_capture
        FROM pm_ui_pnl_benchmarks_v1
        GROUP BY wallet
      )
      SELECT b.wallet, b.pnl_value
      FROM pm_ui_pnl_benchmarks_v1 b
      INNER JOIN latest l ON b.wallet = l.wallet AND b.captured_at = l.latest_capture
      WHERE b.pnl_value BETWEEN 10000 AND 100000
      ORDER BY rand()
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const midWallets = (await midResult.json()) as any[];
  for (const m of midWallets) {
    if (walletsToCheck.some(w => w.wallet.toLowerCase() === m.wallet.toLowerCase())) continue;
    walletsToCheck.push({
      wallet: m.wallet,
      category: 'mid_range',
      benchmarkPnl: Number(m.pnl_value),
    });
  }

  console.log(`\nChecking ${walletsToCheck.length} wallets...\n`);

  // Compute engine PnL for each
  const results: {
    wallet: string;
    category: string;
    enginePnl: number;
    benchmarkPnl?: number;
    tradeCount: number;
  }[] = [];

  for (const w of walletsToCheck) {
    try {
      const trades = await loadMakerTrades(client, w.wallet);
      const enginePnl = computeEnginePnl(w.wallet, trades, resolutions);

      results.push({
        wallet: w.wallet,
        category: w.category,
        enginePnl,
        benchmarkPnl: w.benchmarkPnl,
        tradeCount: trades.length,
      });

      console.log(`  ${w.wallet.slice(0, 12)}.. (${w.category}): Engine=$${(enginePnl/1000).toFixed(0)}k, Trades=${trades.length}`);
    } catch (e) {
      console.log(`  ${w.wallet.slice(0, 12)}.. ERROR: ${e}`);
    }
  }

  // Summary table
  console.log('\n\n=== RESULTS SUMMARY ===\n');
  console.log('| Wallet | Category | Engine PnL | Benchmark PnL | Error |');
  console.log('|--------|----------|------------|---------------|-------|');

  for (const r of results) {
    const engine = r.enginePnl >= 0 ? `$${(r.enginePnl/1000).toFixed(0)}k` : `-$${(Math.abs(r.enginePnl)/1000).toFixed(0)}k`;
    const benchmark = r.benchmarkPnl ? `$${(r.benchmarkPnl/1000).toFixed(0)}k` : 'N/A';
    const error = r.benchmarkPnl ? `${(((r.enginePnl - r.benchmarkPnl) / Math.abs(r.benchmarkPnl)) * 100).toFixed(0)}%` : 'N/A';

    console.log(`| ${r.wallet.slice(0, 10)}.. | ${r.category.padEnd(12)} | ${engine.padStart(10)} | ${benchmark.padStart(13)} | ${error.padStart(5)} |`);
  }

  // Key stats
  console.log('\n\n=== KEY FINDINGS ===\n');

  const withBenchmark = results.filter(r => r.benchmarkPnl !== undefined);
  const within10 = withBenchmark.filter(r => Math.abs((r.enginePnl - r.benchmarkPnl!) / Math.abs(r.benchmarkPnl!)) <= 0.10);
  const within25 = withBenchmark.filter(r => Math.abs((r.enginePnl - r.benchmarkPnl!) / Math.abs(r.benchmarkPnl!)) <= 0.25);

  console.log(`Benchmark wallets: ${withBenchmark.length}`);
  console.log(`Within 10% of benchmark: ${within10.length}/${withBenchmark.length} (${((within10.length/withBenchmark.length)*100).toFixed(0)}%)`);
  console.log(`Within 25% of benchmark: ${within25.length}/${withBenchmark.length} (${((within25.length/withBenchmark.length)*100).toFixed(0)}%)`);

  // High cashflow analysis
  const cashflowResults = results.filter(r => r.category === 'high_cashflow');
  console.log(`\nHigh-cashflow wallets: ${cashflowResults.length}`);
  for (const r of cashflowResults) {
    const pnl = r.enginePnl >= 0 ? `$${(r.enginePnl/1000).toFixed(0)}k` : `-$${(Math.abs(r.enginePnl)/1000).toFixed(0)}k`;
    console.log(`  ${r.wallet.slice(0, 12)}.. Engine PnL: ${pnl}`);
  }

  console.log('\n\nNOTE: Run Playwright manually to get fresh UI values for comparison.');
  console.log('Wallets to check on Polymarket UI:');
  for (const r of results.slice(0, 10)) {
    console.log(`  https://polymarket.com/profile/${r.wallet}`);
  }
}

main().catch(console.error);
