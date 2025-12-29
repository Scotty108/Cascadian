/**
 * Benchmark Cost Basis Engine vs fresh_dec16_2025 benchmark set
 *
 * Tests:
 * 1. Maker-only cost basis (should match V6)
 * 2. Full cost basis (maker+taker with sell capping)
 *
 * Outputs:
 * - Per-wallet PnL vs UI benchmark
 * - Error percentages
 * - Capped sells diagnostics
 * - Summary statistics
 *
 * Run with: npx tsx scripts/pnl/benchmark-cost-basis-dec16.ts
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

interface BenchmarkWallet {
  addr: string;
  uiPnl: number;
}

interface TestResult {
  wallet: string;
  trades: number;
  positions: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  uiPnl: number;
  errorPct: number;
  externalSells: number;
  cappedSellsCount: number;
}

async function loadBenchmarkWallets(client: any): Promise<BenchmarkWallet[]> {
  const result = await client.query({
    query: `
      SELECT wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = 'fresh_dec16_2025'
      ORDER BY pnl_value DESC
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    addr: r.wallet,
    uiPnl: Number(r.pnl_value),
  }));
}

async function loadResolutions(client: any): Promise<Map<string, number>> {
  const result = await client.query({
    query: `
      SELECT
        m.token_id_dec as token_id,
        if(r.payout_numerators IS NULL, NULL,
           if(JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000, 1,
              JSONExtractInt(r.payout_numerators, m.outcome_index + 1))) as payout
      FROM pm_token_to_condition_map_v5 m
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.payout_numerators IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  const resolutions = new Map<string, number>();
  for (const r of rows) {
    if (r.payout !== null) resolutions.set(r.token_id, Number(r.payout));
  }
  return resolutions;
}

async function loadTrades(
  client: any,
  wallet: string,
  makerOnly: boolean
): Promise<any[]> {
  const roleFilter = makerOnly ? "AND role = 'maker'" : '';
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
          ${roleFilter}
        GROUP BY event_id
      )
      SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

function processWallet(
  wallet: string,
  trades: any[],
  resolutions: Map<string, number>
): {
  positions: Position[];
  totalRealized: number;
  totalUnrealized: number;
  totalExternal: number;
  cappedSellsCount: number;
  cappedSellsDetail: Map<string, number>;
} {
  const positions = new Map<string, Position>();
  const cappedSellsDetail = new Map<string, number>();
  let totalExternal = 0;
  let cappedSellsCount = 0;

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
      if (result.externalSell > 0) {
        totalExternal += result.externalSell;
        cappedSellsCount++;
        cappedSellsDetail.set(
          tokenId,
          (cappedSellsDetail.get(tokenId) || 0) + result.externalSell
        );
      }
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
    positions: Array.from(positions.values()),
    totalRealized,
    totalUnrealized,
    totalExternal,
    cappedSellsCount,
    cappedSellsDetail,
  };
}

async function runBenchmark(
  client: any,
  wallets: BenchmarkWallet[],
  resolutions: Map<string, number>,
  makerOnly: boolean
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const mode = makerOnly ? 'MAKER-ONLY' : 'MAKER+TAKER';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${mode} COST BASIS`);
  console.log(`${'='.repeat(70)}\n`);

  for (const w of wallets) {
    const trades = await loadTrades(client, w.addr, makerOnly);
    const processed = processWallet(w.addr, trades, resolutions);

    const totalPnl = processed.totalRealized + processed.totalUnrealized;
    const errorPct = w.uiPnl !== 0 ? ((totalPnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100 : 0;

    results.push({
      wallet: w.addr,
      trades: trades.length,
      positions: processed.positions.length,
      realizedPnl: processed.totalRealized,
      unrealizedPnl: processed.totalUnrealized,
      totalPnl,
      uiPnl: w.uiPnl,
      errorPct,
      externalSells: processed.totalExternal,
      cappedSellsCount: processed.cappedSellsCount,
    });

    const shortAddr = w.addr.slice(0, 10) + '...';
    const pnlStr = `$${(totalPnl / 1e6).toFixed(2)}M`;
    const uiStr = `$${(w.uiPnl / 1e6).toFixed(2)}M`;
    const errStr = `${errorPct.toFixed(1)}%`;
    console.log(`${shortAddr} | PnL: ${pnlStr.padStart(10)} | UI: ${uiStr.padStart(10)} | Err: ${errStr.padStart(8)}`);
  }

  return results;
}

function printSummary(results: TestResult[], mode: string) {
  console.log(`\n--- ${mode} SUMMARY ---\n`);

  const errors = results.map((r) => Math.abs(r.errorPct));
  const within1 = errors.filter((e) => e <= 1).length;
  const within10 = errors.filter((e) => e <= 10).length;
  const median = errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)];

  console.log(`Wallets within 1% error: ${within1}/${results.length} (${((within1 / results.length) * 100).toFixed(0)}%)`);
  console.log(`Wallets within 10% error: ${within10}/${results.length} (${((within10 / results.length) * 100).toFixed(0)}%)`);
  console.log(`Median absolute error: ${median.toFixed(1)}%`);

  const totalExternal = results.reduce((s, r) => s + r.externalSells, 0);
  const totalCapped = results.reduce((s, r) => s + r.cappedSellsCount, 0);
  console.log(`Total external sells: ${(totalExternal / 1e6).toFixed(2)}M tokens`);
  console.log(`Total capped sell events: ${totalCapped}`);
}

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   COST BASIS BENCHMARK - fresh_dec16_2025 (9 wallets)                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  // Load data
  console.log('\nLoading benchmark wallets...');
  const wallets = await loadBenchmarkWallets(client);
  console.log(`Loaded ${wallets.length} wallets`);

  console.log('Loading resolutions...');
  const resolutions = await loadResolutions(client);
  console.log(`Loaded ${resolutions.size} resolved tokens`);

  // Run maker-only benchmark
  const makerOnlyResults = await runBenchmark(client, wallets, resolutions, true);
  printSummary(makerOnlyResults, 'MAKER-ONLY');

  // Run full (maker+taker) benchmark
  const fullResults = await runBenchmark(client, wallets, resolutions, false);
  printSummary(fullResults, 'MAKER+TAKER');

  // Comparison table
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   COMPARISON TABLE                                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('| Wallet | UI PnL | Maker PnL | Maker Err | Full PnL | Full Err | Ext Sells |');
  console.log('|--------|--------|-----------|-----------|----------|----------|-----------|');

  for (let i = 0; i < wallets.length; i++) {
    const mo = makerOnlyResults[i];
    const full = fullResults[i];
    const shortAddr = wallets[i].addr.slice(0, 8) + '..';

    const uiStr = `$${(mo.uiPnl / 1e6).toFixed(1)}M`;
    const moPnl = `$${(mo.totalPnl / 1e6).toFixed(1)}M`;
    const moErr = `${mo.errorPct.toFixed(1)}%`;
    const fullPnl = `$${(full.totalPnl / 1e6).toFixed(1)}M`;
    const fullErr = `${full.errorPct.toFixed(1)}%`;
    const extSells = `${(full.externalSells / 1e6).toFixed(1)}M`;

    console.log(
      `| ${shortAddr.padEnd(6)} | ${uiStr.padStart(6)} | ${moPnl.padStart(9)} | ${moErr.padStart(9)} | ${fullPnl.padStart(8)} | ${fullErr.padStart(8)} | ${extSells.padStart(9)} |`
    );
  }

  // Final conclusion
  console.log('\n\n=== CONCLUSION ===\n');

  const moWithin1 = makerOnlyResults.filter((r) => Math.abs(r.errorPct) <= 1).length;
  const fullWithin1 = fullResults.filter((r) => Math.abs(r.errorPct) <= 1).length;

  console.log(`Maker-only: ${moWithin1}/${wallets.length} within 1% error`);
  console.log(`Full (maker+taker): ${fullWithin1}/${wallets.length} within 1% error`);
  console.log('');

  if (moWithin1 >= fullWithin1) {
    console.log('RECOMMENDATION: Maker-only remains the best UI-parity approach.');
  } else {
    console.log('FINDING: Full cost basis improves parity for some wallets.');
  }
}

main().catch(console.error);
