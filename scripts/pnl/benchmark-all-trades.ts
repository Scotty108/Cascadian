/**
 * Benchmark using ALL trades (maker + taker) vs maker-only
 *
 * Tests hypothesis that including taker trades fixes the -100% outliers
 *
 * Run with: npx tsx scripts/pnl/benchmark-all-trades.ts
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

// Load ALL trades (maker + taker), deduped by (event_id, role)
// This handles cases where wallet is both maker AND taker in same event (router scenario)
async function loadAllTrades(client: any, wallet: string): Promise<any[]> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          role,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
          -- NO role filter: include both maker AND taker
        GROUP BY event_id, role
      )
      SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

// Load only maker trades (original approach)
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

async function main() {
  const client = getClickHouseClient();

  console.log('Loading benchmarks...');
  const wallets = await loadBenchmarks(client);
  console.log(`Loaded ${wallets.length} wallets`);

  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  // Test on the taker-heavy outliers first
  const takerHeavyWallets = [
    '0x3b6fd06a5915ab90d01b052b6937f4eb7ffa1c07',
    '0x12d6cccfc766d3c43a8f7fddb17ee10c5e47a5ed',
    '0x662244931c16cb1e6c72d91f26cc1b2af0d25b06',
    '0xeb6f0a4aaf1f10f0cfb82f55e5e2f1f07bc4f6a0',
  ];

  console.log('=== TAKER-HEAVY WALLET COMPARISON ===\n');
  console.log('| Wallet | UI PnL | Maker-Only | All-Trades | Maker Err | All Err |');
  console.log('|--------|--------|------------|------------|-----------|---------|');

  for (const addr of takerHeavyWallets) {
    const benchmark = wallets.find((w) => w.addr.toLowerCase() === addr.toLowerCase());
    if (!benchmark) continue;

    const makerTrades = await loadMakerTrades(client, addr);
    const allTrades = await loadAllTrades(client, addr);

    const makerPnL = computePnL(addr, makerTrades, resolutions);
    const allPnL = computePnL(addr, allTrades, resolutions);

    const makerTotal = makerPnL.realized + makerPnL.unrealized;
    const allTotal = allPnL.realized + allPnL.unrealized;

    const makerErr = benchmark.uiPnl !== 0 ? ((makerTotal - benchmark.uiPnl) / Math.abs(benchmark.uiPnl)) * 100 : 0;
    const allErr = benchmark.uiPnl !== 0 ? ((allTotal - benchmark.uiPnl) / Math.abs(benchmark.uiPnl)) * 100 : 0;

    const ui = `$${(benchmark.uiPnl / 1000).toFixed(0)}k`;
    const maker = `$${(makerTotal / 1000).toFixed(0)}k`;
    const all = `$${(allTotal / 1000).toFixed(0)}k`;

    console.log(
      `| ${addr.slice(0, 8)}.. | ${ui.padStart(6)} | ${maker.padStart(10)} | ${all.padStart(10)} | ${makerErr.toFixed(0).padStart(9)}% | ${allErr.toFixed(0).padStart(7)}% |`
    );
    console.log(`    Trades: maker=${makerTrades.length}, all=${allTrades.length}`);
  }

  // Now run full benchmark with all trades
  console.log('\n\n=== FULL BENCHMARK: ALL TRADES ===\n');

  const results: { wallet: string; uiPnl: number; makerPnl: number; allPnl: number; makerErr: number; allErr: number }[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];

    try {
      const makerTrades = await loadMakerTrades(client, w.addr);
      const allTrades = await loadAllTrades(client, w.addr);

      const makerPnL = computePnL(w.addr, makerTrades, resolutions);
      const allPnL = computePnL(w.addr, allTrades, resolutions);

      const makerTotal = makerPnL.realized + makerPnL.unrealized;
      const allTotal = allPnL.realized + allPnL.unrealized;

      const makerErr = w.uiPnl !== 0 ? Math.abs((makerTotal - w.uiPnl) / Math.abs(w.uiPnl)) * 100 : 0;
      const allErr = w.uiPnl !== 0 ? Math.abs((allTotal - w.uiPnl) / Math.abs(w.uiPnl)) * 100 : 0;

      results.push({ wallet: w.addr, uiPnl: w.uiPnl, makerPnl: makerTotal, allPnl: allTotal, makerErr, allErr });
    } catch {
      continue;
    }

    if ((i + 1) % 20 === 0) {
      process.stdout.write(`\rProcessed ${i + 1}/${wallets.length}`);
    }
  }
  console.log('\n');

  // Summary stats
  const thresholds = [1, 5, 10, 25, 50];
  console.log('| Threshold | Maker-Only | All-Trades |');
  console.log('|-----------|------------|------------|');
  for (const t of thresholds) {
    const makerWithin = results.filter((r) => r.makerErr <= t).length;
    const allWithin = results.filter((r) => r.allErr <= t).length;
    console.log(
      `| ≤${t.toString().padStart(2)}% | ${makerWithin.toString().padStart(3)}/${results.length} (${((makerWithin / results.length) * 100).toFixed(0).padStart(2)}%) | ${allWithin.toString().padStart(3)}/${results.length} (${((allWithin / results.length) * 100).toFixed(0).padStart(2)}%) |`
    );
  }

  // Show wallets that improved significantly
  console.log('\n\n=== WALLETS WHERE ALL-TRADES SIGNIFICANTLY BETTER ===\n');
  const improved = results
    .filter((r) => r.makerErr > 25 && r.allErr < r.makerErr - 10)
    .sort((a, b) => (b.makerErr - b.allErr) - (a.makerErr - a.allErr));

  for (const r of improved.slice(0, 10)) {
    console.log(`${r.wallet.slice(0, 12)}.. UI: $${(r.uiPnl / 1000).toFixed(0)}k, Maker: ${r.makerErr.toFixed(0)}% err, All: ${r.allErr.toFixed(0)}% err`);
  }
}

main().catch(console.error);
