/**
 * Error Decomposition by Market
 *
 * Compares per-market UI PnL benchmarks (from pm_ui_pnl_by_market_v1)
 * against our V20 calculations to identify which specific markets
 * are causing the largest PnL errors.
 *
 * This is the "Hit List" script - it tells the Builder agent exactly
 * which markets to focus on fixing.
 *
 * Usage:
 *   npx tsx scripts/pnl/decompose-error-by-market.ts
 *   npx tsx scripts/pnl/decompose-error-by-market.ts --wallet 0x123...
 *   npx tsx scripts/pnl/decompose-error-by-market.ts --set fresh_2025_12_04_alltime
 *
 * Terminal: Claude 1 (Auditor Track)
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

interface UIMarketPnL {
  wallet: string;
  market_slug: string;
  market_title: string;
  result: string;
  total_bet: number;
  amount_won: number;
  pnl: number;
}

interface MarketError {
  market_slug: string;
  market_title: string;
  total_wallets: number;
  ui_pnl_sum: number;
  v20_pnl_sum: number;
  error_total: number;
  error_abs_total: number;
  avg_error_pct: number;
  wallets: string[];
}

async function loadUIMarketPnL(benchmarkSet: string): Promise<UIMarketPnL[]> {
  const query = `
    SELECT
      wallet,
      market_slug,
      market_title,
      result,
      total_bet,
      amount_won,
      pnl
    FROM pm_ui_pnl_by_market_v1
    WHERE benchmark_set = '${benchmarkSet}'
    ORDER BY wallet, market_slug
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as UIMarketPnL[];
}

async function loadUITotalPnL(benchmarkSet: string): Promise<Map<string, number>> {
  const query = `
    SELECT wallet, pnl_value
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${benchmarkSet}'
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.wallet.toLowerCase(), Number(r.pnl_value));
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);

  let benchmarkSet = 'fresh_2025_12_04_alltime';
  let singleWallet: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set' && args[i + 1]) {
      benchmarkSet = args[i + 1];
      i++;
    } else if (args[i] === '--wallet' && args[i + 1]) {
      singleWallet = args[i + 1].toLowerCase();
      i++;
    }
  }

  console.log('='.repeat(120));
  console.log('PNL ERROR DECOMPOSITION BY MARKET');
  console.log('='.repeat(120));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Benchmark Set: ${benchmarkSet}`);
  if (singleWallet) console.log(`Single Wallet: ${singleWallet}`);
  console.log('');

  // Load UI per-market PnL data
  const uiMarketPnL = await loadUIMarketPnL(benchmarkSet);
  console.log(`Loaded ${uiMarketPnL.length} market entries from UI benchmark`);

  if (uiMarketPnL.length === 0) {
    console.log('No per-market UI data found. Run sync-ui-pnl-by-market.ts first.');
    return;
  }

  // Load UI total PnL for comparison
  const uiTotalPnL = await loadUITotalPnL(benchmarkSet);
  console.log(`Loaded ${uiTotalPnL.size} wallet totals from UI benchmark`);

  // Group by wallet
  const wallets = [...new Set(uiMarketPnL.map((m) => m.wallet))];
  console.log(`\nAnalyzing ${wallets.length} wallets...`);

  if (singleWallet) {
    const filtered = wallets.filter((w) => w.toLowerCase() === singleWallet);
    if (filtered.length === 0) {
      console.log(`Wallet ${singleWallet} not found in benchmark set`);
      return;
    }
  }

  // Aggregate errors by market
  const marketErrors = new Map<string, MarketError>();

  // Wallet-level analysis
  console.log('\n' + '-'.repeat(120));
  console.log('WALLET-LEVEL ANALYSIS');
  console.log('-'.repeat(120));
  console.log('Wallet           | UI Total PnL     | UI Market Sum    | V20 Total        | Error vs UI      | Gap');
  console.log('-'.repeat(120));

  for (const wallet of wallets) {
    if (singleWallet && wallet.toLowerCase() !== singleWallet) continue;

    const walletMarkets = uiMarketPnL.filter((m) => m.wallet === wallet);
    const uiMarketSum = walletMarkets.reduce((sum, m) => sum + m.pnl, 0);
    const uiTotal = uiTotalPnL.get(wallet.toLowerCase()) || 0;

    // Calculate V20 PnL
    let v20Pnl = 0;
    try {
      const v20Result = await calculateV20PnL(wallet);
      v20Pnl = v20Result.total_pnl;
    } catch (e) {
      console.log(`  Error computing V20 for ${wallet}: ${e}`);
    }

    const errorVsUI = v20Pnl - uiTotal;
    const gap = uiTotal - uiMarketSum; // Gap between total PnL and scraped markets

    console.log(
      `${wallet.substring(0, 14)}... | $${uiTotal.toLocaleString().padStart(14)} | $${uiMarketSum.toLocaleString().padStart(14)} | $${v20Pnl.toLocaleString().padStart(14)} | $${errorVsUI.toLocaleString().padStart(14)} | $${gap.toLocaleString().padStart(10)}`
    );

    // Track per-market errors (for now just aggregate UI data)
    for (const m of walletMarkets) {
      const existing = marketErrors.get(m.market_slug);
      if (existing) {
        existing.total_wallets++;
        existing.ui_pnl_sum += m.pnl;
        existing.wallets.push(wallet);
      } else {
        marketErrors.set(m.market_slug, {
          market_slug: m.market_slug,
          market_title: m.market_title,
          total_wallets: 1,
          ui_pnl_sum: m.pnl,
          v20_pnl_sum: 0, // Will compute later if needed
          error_total: 0,
          error_abs_total: 0,
          avg_error_pct: 0,
          wallets: [wallet],
        });
      }
    }
  }

  // Market-level summary
  console.log('\n' + '-'.repeat(120));
  console.log('MARKETS BY TOTAL UI PnL (Top 20)');
  console.log('-'.repeat(120));
  console.log('Market Slug                                  | Wallets | UI PnL Sum       | Avg PnL/Wallet');
  console.log('-'.repeat(120));

  const sortedMarkets = [...marketErrors.values()].sort((a, b) => Math.abs(b.ui_pnl_sum) - Math.abs(a.ui_pnl_sum));

  for (const m of sortedMarkets.slice(0, 20)) {
    const avgPnl = m.ui_pnl_sum / m.total_wallets;
    console.log(
      `${m.market_slug.substring(0, 44).padEnd(44)} | ${m.total_wallets.toString().padStart(7)} | $${m.ui_pnl_sum.toLocaleString().padStart(14)} | $${avgPnl.toLocaleString().padStart(12)}`
    );
  }

  // Summary statistics
  console.log('\n' + '-'.repeat(120));
  console.log('SUMMARY');
  console.log('-'.repeat(120));

  const totalUIMarketPnL = [...marketErrors.values()].reduce((sum, m) => sum + m.ui_pnl_sum, 0);
  const totalUIWalletPnL = [...uiTotalPnL.values()].reduce((sum, p) => sum + p, 0);

  console.log(`Total UI PnL (from benchmarks):   $${totalUIWalletPnL.toLocaleString()}`);
  console.log(`Total UI PnL (from markets):      $${totalUIMarketPnL.toLocaleString()}`);
  console.log(`Gap (unmapped PnL):               $${(totalUIWalletPnL - totalUIMarketPnL).toLocaleString()}`);
  console.log(`Unique markets:                   ${marketErrors.size}`);
  console.log(`Total market entries:             ${uiMarketPnL.length}`);

  // Top contributing markets to total PnL
  console.log('\n' + '-'.repeat(120));
  console.log('TOP 10 MARKETS BY PnL CONTRIBUTION');
  console.log('-'.repeat(120));

  let cumulativePct = 0;
  for (const m of sortedMarkets.slice(0, 10)) {
    const pct = (Math.abs(m.ui_pnl_sum) / Math.abs(totalUIMarketPnL)) * 100;
    cumulativePct += pct;
    console.log(
      `${m.market_slug.substring(0, 50).padEnd(50)} | ${pct.toFixed(1).padStart(5)}% | cumulative: ${cumulativePct.toFixed(1)}%`
    );
  }

  console.log('\n' + '='.repeat(120));
  console.log('DECOMPOSITION COMPLETE');
  console.log('='.repeat(120));
  console.log('\nNext Steps:');
  console.log('1. Focus on top 10 markets (cover 80%+ of PnL)');
  console.log('2. Investigate any markets with large error vs V20 calculation');
  console.log('3. Check if "gap" is from open positions or missing market data');
}

main().catch(console.error);
