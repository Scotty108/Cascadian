/**
 * Test V12 Unified Trade Stream Engine
 *
 * V12 incorporates:
 * - CLOB trades (order book)
 * - CTF splits (create positions at $0.50)
 * - CTF merges (close positions at $0.50)
 * - CTF redemptions (cash out at $1.00)
 * - FPMM trades (older AMM)
 *
 * This should fix the avg_price discrepancy for wallets that use CTF splits.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import {
  createV12Engine,
  calculateOmegaRatio,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateWinRate,
  calculateROI,
  calculateProfitFactor,
} from '../../lib/pnl/uiActivityEngineV12';

// Test wallets
const TEST_WALLETS = [
  {
    address: '0x9d36c904930a7d06c5403f9e16996e919f586486',
    name: 'Theo (NegRisk trader - needs API data)',
    expectedPnl: 12299, // From pm_api_positions
    usesNegRisk: true,
  },
  {
    address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    name: 'Active Trader (pure CLOB)',
    expectedPnl: -10_000_000, // From UI
    usesNegRisk: false,
  },
];

async function getApiPnL(wallet: string): Promise<number> {
  const result = await clickhouse.query({
    query: `
      SELECT sum(realized_pnl) as total
      FROM pm_api_positions
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return Number(rows[0]?.total || 0);
}

async function main() {
  console.log('='.repeat(80));
  console.log('V12 UNIFIED TRADE STREAM TEST');
  console.log('='.repeat(80));

  const engine = createV12Engine();

  for (const w of TEST_WALLETS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Wallet: ${w.name}`);
    console.log(`Address: ${w.address}`);
    console.log(`${'─'.repeat(80)}`);

    const result = await engine.compute(w.address);

    // Get API PnL for comparison
    const apiPnl = await getApiPnL(w.address);

    console.log('\n[Trade Sources]');
    console.log(`  CLOB trades: ${result.clob_trades}`);
    console.log(`  CTF splits: ${result.ctf_splits}`);
    console.log(`  CTF merges: ${result.ctf_merges}`);
    console.log(`  CTF redemptions: ${result.ctf_redemptions}`);
    console.log(`  FPMM trades: ${result.fpmm_trades}`);
    console.log(`  NegRisk trades: ${result.negrisk_trades}`);

    console.log('\n[Volume]');
    console.log(`  Total: $${result.volume_traded.toFixed(2)}`);
    console.log(`  Buys: $${result.volume_buys.toFixed(2)} (${result.buys_count} trades)`);
    console.log(`  Sells: $${result.volume_sells.toFixed(2)} (${result.sells_count} trades)`);

    console.log('\n[PnL]');
    console.log(`  V12 Realized PnL: $${result.realized_pnl.toFixed(2)}`);
    console.log(`  API Realized PnL: $${apiPnl.toFixed(2)}`);
    console.log(`  Expected (UI): $${w.expectedPnl.toFixed(2)}`);

    const diffFromApi = result.realized_pnl - apiPnl;
    const diffFromExpected = result.realized_pnl - w.expectedPnl;
    const pctErrorApi = apiPnl !== 0 ? Math.abs(diffFromApi / apiPnl * 100) : 0;
    const pctErrorExpected = w.expectedPnl !== 0 ? Math.abs(diffFromExpected / w.expectedPnl * 100) : 0;

    console.log(`  Diff from API: $${diffFromApi.toFixed(2)} (${pctErrorApi.toFixed(1)}%)`);
    console.log(`  Diff from Expected: $${diffFromExpected.toFixed(2)} (${pctErrorExpected.toFixed(1)}%)`);

    console.log('\n[Derived Metrics]');
    const omega = calculateOmegaRatio(result.trade_returns);
    const sharpe = calculateSharpeRatio(result.trade_returns);
    const sortino = calculateSortinoRatio(result.trade_returns);
    const winRate = calculateWinRate(result.trade_returns);
    const roi = calculateROI(result.trade_returns);
    const profitFactor = calculateProfitFactor(result.trade_returns);

    console.log(`  Omega Ratio: ${omega === Infinity ? '∞' : omega.toFixed(4)}`);
    console.log(`  Sharpe Ratio: ${sharpe.toFixed(4)}`);
    console.log(`  Sortino Ratio: ${sortino === Infinity ? '∞' : sortino.toFixed(4)}`);
    console.log(`  Win Rate: ${(winRate * 100).toFixed(1)}%`);
    console.log(`  ROI: ${(roi * 100).toFixed(2)}%`);
    console.log(`  Profit Factor: ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
    console.log(`  Trade Returns Count: ${result.trade_returns.length}`);

    // Show trade returns by source
    const bySource: Record<string, number> = {};
    for (const tr of result.trade_returns) {
      bySource[tr.source] = (bySource[tr.source] || 0) + 1;
    }
    console.log('\n[Trade Returns by Source]');
    for (const [source, count] of Object.entries(bySource)) {
      console.log(`  ${source}: ${count}`);
    }

    // Accuracy assessment
    console.log('\n[Accuracy]');
    if (pctErrorExpected < 5) {
      console.log(`  ✓ PASS - Within 5% of expected`);
    } else if (pctErrorExpected < 20) {
      console.log(`  ~ CLOSE - Within 20% of expected`);
    } else {
      console.log(`  ✗ NEEDS INVESTIGATION`);
      if ((w as any).usesNegRisk) {
        console.log(`  NOTE: This wallet uses NegRisk markets - V12 requires API data for accuracy`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
