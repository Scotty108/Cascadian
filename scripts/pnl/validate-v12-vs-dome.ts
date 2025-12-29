/**
 * Validate V12 Cash Flow PnL Engine vs Dome Benchmarks
 *
 * Compares V11 (position-based) and V12 (cash-flow) engines against Dome API
 * to see which performs better on wallets with phantom sell patterns.
 */
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { computeCashFlowPnl } from '../../lib/pnl/cashFlowPnlEngine';
import { clickhouse } from '../../lib/clickhouse/client';

interface DomeBenchmark {
  wallet_address: string;
  dome_realized_value: number;
}

interface ValidationResult {
  wallet: string;
  dome: number;
  v11: number;
  v12: number;
  v11_error: number;
  v12_error: number;
  v11_better: boolean;
  phantom_sell_count: number;
  redeem_count: number;
}

async function validate() {
  console.log('=== V12 Cash Flow vs V11 Position-Based Validation ===\n');

  // Load Dome benchmarks
  const benchmarkQuery = `
    SELECT wallet_address, dome_realized_value
    FROM pm_dome_realized_benchmarks_v1
    WHERE dome_realized_value IS NOT NULL
      AND dome_confidence = 'high'
    ORDER BY abs(dome_realized_value) DESC
    LIMIT 50
  `;

  const benchmarkResult = await clickhouse.query({
    query: benchmarkQuery,
    format: 'JSONEachRow',
  });

  const benchmarks = (await benchmarkResult.json()) as DomeBenchmark[];
  console.log('Loaded', benchmarks.length, 'Dome benchmarks\n');

  const results: ValidationResult[] = [];
  let v11Wins = 0;
  let v12Wins = 0;
  let ties = 0;

  for (let i = 0; i < benchmarks.length; i++) {
    const bench = benchmarks[i];
    const wallet = bench.wallet_address;
    const domeValue = bench.dome_realized_value;

    process.stdout.write(`Processing ${i + 1}/${benchmarks.length}: ${wallet.slice(0, 10)}... `);

    try {
      const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
        includeSyntheticRedemptions: false,
        includeErc1155Transfers: false,
      });

      // Count phantom sells and redemptions
      const buys = events.filter(e => e.eventType === 'ORDER_MATCHED_BUY');
      const sells = events.filter(e => e.eventType === 'ORDER_MATCHED_SELL');
      const redemptions = events.filter(e => e.eventType === 'REDEMPTION');

      const tokensWithBuys = new Set(buys.map(e => e.tokenId.toString()));
      const phantomSells = sells.filter(s => !tokensWithBuys.has(s.tokenId.toString()));

      // Calculate both engines
      const v11Result = computeWalletPnlFromEvents(wallet, events);
      const v12Result = computeCashFlowPnl(wallet, events);

      const v11Error = Math.abs(v11Result.realizedPnl - domeValue);
      const v12Error = Math.abs(v12Result.realizedPnl - domeValue);

      let v11Better = v11Error < v12Error;
      if (Math.abs(v11Error - v12Error) < 1) {
        // Tie if within $1
        ties++;
        v11Better = v11Error <= v12Error;
      } else if (v11Better) {
        v11Wins++;
      } else {
        v12Wins++;
      }

      results.push({
        wallet,
        dome: domeValue,
        v11: v11Result.realizedPnl,
        v12: v12Result.realizedPnl,
        v11_error: v11Error,
        v12_error: v12Error,
        v11_better: v11Better,
        phantom_sell_count: phantomSells.length,
        redeem_count: redemptions.length,
      });

      const winner = v11Better ? 'V11' : 'V12';
      console.log(`Done (${winner} wins, phantoms=${phantomSells.length})`);
    } catch (err) {
      console.log(`Error: ${err}`);
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('V11 wins:', v11Wins);
  console.log('V12 wins:', v12Wins);
  console.log('Ties:', ties);
  console.log('V12 win rate:', ((v12Wins / results.length) * 100).toFixed(1) + '%');

  // Analyze phantom sell correlation
  const phantomSellResults = results.filter(r => r.phantom_sell_count > 0);
  const v12WinsWithPhantoms = phantomSellResults.filter(r => !r.v11_better).length;
  console.log('\n=== Phantom Sell Analysis ===');
  console.log('Wallets with phantom sells:', phantomSellResults.length);
  console.log('V12 wins on phantom sell wallets:', v12WinsWithPhantoms);
  console.log('V12 win rate on phantom sell wallets:', ((v12WinsWithPhantoms / phantomSellResults.length) * 100).toFixed(1) + '%');

  // Show top improvements from V12
  console.log('\n=== Top 10 V12 Improvements ===');
  const v12Improvements = results
    .filter(r => r.v12_error < r.v11_error)
    .sort((a, b) => (b.v11_error - b.v12_error) - (a.v11_error - a.v12_error))
    .slice(0, 10);

  for (const r of v12Improvements) {
    const improvement = r.v11_error - r.v12_error;
    console.log(`  ${r.wallet.slice(0, 12)}... Dome=$${r.dome.toFixed(0)} V11 err=$${r.v11_error.toFixed(0)} V12 err=$${r.v12_error.toFixed(0)} Improvement=$${improvement.toFixed(0)} phantoms=${r.phantom_sell_count}`);
  }

  // Show cases where V12 is worse
  console.log('\n=== Top 10 V12 Regressions ===');
  const v12Regressions = results
    .filter(r => r.v12_error > r.v11_error)
    .sort((a, b) => (b.v12_error - b.v11_error) - (a.v12_error - a.v11_error))
    .slice(0, 10);

  for (const r of v12Regressions) {
    const regression = r.v12_error - r.v11_error;
    console.log(`  ${r.wallet.slice(0, 12)}... Dome=$${r.dome.toFixed(0)} V11 err=$${r.v11_error.toFixed(0)} V12 err=$${r.v12_error.toFixed(0)} Regression=$${regression.toFixed(0)} phantoms=${r.phantom_sell_count}`);
  }

  // Pass rate comparison (5% threshold)
  const passThreshold = 0.05;
  const v11Passes = results.filter(r => {
    if (r.dome === 0) return r.v11 === 0;
    return Math.abs(r.v11_error / r.dome) < passThreshold;
  }).length;
  const v12Passes = results.filter(r => {
    if (r.dome === 0) return r.v12 === 0;
    return Math.abs(r.v12_error / r.dome) < passThreshold;
  }).length;

  console.log('\n=== Pass Rate (5% threshold) ===');
  console.log('V11 pass rate:', ((v11Passes / results.length) * 100).toFixed(1) + '%');
  console.log('V12 pass rate:', ((v12Passes / results.length) * 100).toFixed(1) + '%');
}

validate().catch(console.error);
