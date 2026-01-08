import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { getWalletPnl } from '../lib/pnl/getWalletPnl';

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
  maker_ratio: number;
  total_trades: number;
  total_volume: number;
  wallet_type: string;
}

interface ValidationResult {
  wallet: string;
  wallet_type: string;
  maker_ratio: number;
  ui_pnl: number;
  computed_pnl: number;
  error_pct: number;
  absolute_error: number;
}

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 300000,
  });

  // Get Tier-A benchmark wallets with maker ratio
  const benchmarkResult = await client.query({
    query: `
      WITH clob_wallets AS (
        SELECT
          lower(trader_wallet) as wallet,
          count() as total_trades,
          uniqExact(toDate(trade_time)) as active_days,
          sum(usdc_amount) / 1e6 as total_volume,
          uniqExact(token_id) as unique_markets,
          max(trade_time) as last_trade,
          dateDiff('day', min(trade_time), max(trade_time)) + 1 as account_span_days,
          countIf(role = 'maker') / count() as maker_ratio
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY trader_wallet
      ),
      filtered AS (
        SELECT c.*
        FROM clob_wallets c
        INNER JOIN pm_wallet_external_activity_60d e ON c.wallet = lower(e.wallet)
        WHERE e.confidence_tier = 'A'
          AND c.total_trades / greatest(c.account_span_days / 7.0, 1) >= 1.0
          AND c.last_trade >= now() - INTERVAL 10 DAY
          AND c.total_volume >= 500
          AND c.total_trades / c.active_days < 300
          AND c.unique_markets >= 2
      )
      SELECT
        f.wallet,
        f.maker_ratio,
        f.total_trades,
        f.total_volume,
        b.pnl_value,
        CASE
          WHEN f.maker_ratio >= 0.8 THEN 'maker_heavy'
          WHEN f.maker_ratio <= 0.2 THEN 'taker_heavy'
          WHEN f.maker_ratio > 0.5 THEN 'mixed_maker_lean'
          ELSE 'mixed_taker_lean'
        END as wallet_type
      FROM filtered f
      INNER JOIN pm_ui_pnl_benchmarks_v1 b ON f.wallet = lower(b.wallet)
    `,
    format: 'JSONEachRow'
  });
  const benchmarks = await benchmarkResult.json() as BenchmarkRow[];

  // Dedupe by wallet (some wallets appear multiple times in benchmark)
  const uniqueBenchmarks = new Map<string, BenchmarkRow>();
  benchmarks.forEach(b => {
    if (!uniqueBenchmarks.has(b.wallet)) {
      uniqueBenchmarks.set(b.wallet, b);
    }
  });
  const dedupedBenchmarks = Array.from(uniqueBenchmarks.values());

  console.log('Tier-A benchmark wallets to validate:', dedupedBenchmarks.length);
  console.log('By type:');
  const byType: Record<string, BenchmarkRow[]> = {};
  dedupedBenchmarks.forEach(b => {
    if (!byType[b.wallet_type]) byType[b.wallet_type] = [];
    byType[b.wallet_type].push(b);
  });
  Object.entries(byType).forEach(([type, wallets]) => {
    console.log(`  ${type}: ${wallets.length}`);
  });

  const results: ValidationResult[] = [];
  let processed = 0;

  for (const benchmark of dedupedBenchmarks) {
    try {
      const pnl = await getWalletPnl(benchmark.wallet);
      const computedPnl = pnl.realized_pnl + pnl.unrealized_pnl;
      const uiPnl = benchmark.pnl_value;

      const absoluteError = Math.abs(computedPnl - uiPnl);
      const errorPct = uiPnl !== 0 ? (absoluteError / Math.abs(uiPnl)) * 100 : (computedPnl === 0 ? 0 : 100);

      results.push({
        wallet: benchmark.wallet,
        wallet_type: benchmark.wallet_type,
        maker_ratio: benchmark.maker_ratio,
        ui_pnl: uiPnl,
        computed_pnl: computedPnl,
        error_pct: errorPct,
        absolute_error: absoluteError
      });

      processed++;
      if (processed % 10 === 0) {
        console.log(`Processed ${processed}/${dedupedBenchmarks.length}...`);
      }
    } catch (error) {
      console.error(`Error processing ${benchmark.wallet}:`, error);
    }
  }

  // Overall stats
  results.sort((a, b) => a.error_pct - b.error_pct);
  const avgError = results.reduce((sum, r) => sum + r.error_pct, 0) / results.length;
  const medianError = results[Math.floor(results.length / 2)].error_pct;
  const under10 = results.filter(r => r.error_pct < 10).length;
  const under20 = results.filter(r => r.error_pct < 20).length;
  const under50 = results.filter(r => r.error_pct < 50).length;

  console.log('\n=== OVERALL TIER-A VALIDATION RESULTS ===');
  console.log(`Total wallets validated: ${results.length}`);
  console.log(`Average Error: ${avgError.toFixed(1)}%`);
  console.log(`Median Error: ${medianError.toFixed(1)}%`);
  console.log(`<10% error: ${under10}/${results.length} (${(under10/results.length*100).toFixed(0)}%)`);
  console.log(`<20% error: ${under20}/${results.length} (${(under20/results.length*100).toFixed(0)}%)`);
  console.log(`<50% error: ${under50}/${results.length} (${(under50/results.length*100).toFixed(0)}%)`);

  // Stats by wallet type
  console.log('\n=== RESULTS BY WALLET TYPE ===');
  for (const type of ['maker_heavy', 'taker_heavy', 'mixed_maker_lean', 'mixed_taker_lean']) {
    const typeResults = results.filter(r => r.wallet_type === type);
    if (typeResults.length === 0) {
      console.log(`\n${type.toUpperCase()}: No wallets`);
      continue;
    }

    const typeAvg = typeResults.reduce((sum, r) => sum + r.error_pct, 0) / typeResults.length;
    const typeMedian = typeResults.sort((a, b) => a.error_pct - b.error_pct)[Math.floor(typeResults.length / 2)].error_pct;
    const typeUnder10 = typeResults.filter(r => r.error_pct < 10).length;
    const typeUnder20 = typeResults.filter(r => r.error_pct < 20).length;

    console.log(`\n${type.toUpperCase()} (${typeResults.length} wallets):`);
    console.log(`  Avg Error: ${typeAvg.toFixed(1)}%`);
    console.log(`  Median Error: ${typeMedian.toFixed(1)}%`);
    console.log(`  <10% error: ${typeUnder10}/${typeResults.length} (${(typeUnder10/typeResults.length*100).toFixed(0)}%)`);
    console.log(`  <20% error: ${typeUnder20}/${typeResults.length} (${(typeUnder20/typeResults.length*100).toFixed(0)}%)`);

    // Show examples
    console.log(`  Best: ${typeResults[0].wallet.slice(0,10)}... UI:$${typeResults[0].ui_pnl.toFixed(0)} Computed:$${typeResults[0].computed_pnl.toFixed(0)} Error:${typeResults[0].error_pct.toFixed(1)}%`);
    if (typeResults.length > 1) {
      const worst = typeResults[typeResults.length - 1];
      console.log(`  Worst: ${worst.wallet.slice(0,10)}... UI:$${worst.ui_pnl.toFixed(0)} Computed:$${worst.computed_pnl.toFixed(0)} Error:${worst.error_pct.toFixed(1)}%`);
    }
  }

  console.log('\n=== TOP 10 BEST MATCHES ===');
  results.slice(0, 10).forEach(r => {
    console.log(`  [${r.wallet_type}] ${r.wallet.slice(0,10)}... maker:${(r.maker_ratio*100).toFixed(0)}% UI:$${r.ui_pnl.toFixed(0)} Computed:$${r.computed_pnl.toFixed(0)} Error:${r.error_pct.toFixed(1)}%`);
  });

  console.log('\n=== BOTTOM 10 WORST MATCHES ===');
  results.slice(-10).forEach(r => {
    console.log(`  [${r.wallet_type}] ${r.wallet.slice(0,10)}... maker:${(r.maker_ratio*100).toFixed(0)}% UI:$${r.ui_pnl.toFixed(0)} Computed:$${r.computed_pnl.toFixed(0)} Error:${r.error_pct.toFixed(1)}%`);
  });

  await client.close();
}

main().catch(console.error);
