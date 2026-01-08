import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { getWalletPnl } from '../lib/pnl/getWalletPnl';

// Wallets WITHOUT CLOB trades (to exclude)
const nonClobWallets = new Set([
  '0x12d6cccfc766d3c43a8f7fddb17ee10c5e47a5ed',
  '0x3b6fd06a5915ab90d01b052b6937f4eb7ffa1c07',
  '0x418db17eaab13c6bfef00e3e9c66f60e54f7f546',
  '0x662244931c16cb1e6c72d91f26cc1b2af0d25b06',
  '0x7dca4d9f31fc38db98c7feebea9e0c8be1b39a71',
  '0xeab03de44f5a2f33e5e8ea9f5c09c8f31b4b5ae7',
  '0xeb6f0a13ea3f0eb8fb8c5d45c703cbf74d0d2f34'
]);

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
}

interface ValidationResult {
  wallet: string;
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
  });

  // Get benchmark wallets with their PnL values
  const benchmarkResult = await client.query({
    query: `
      SELECT lower(wallet) as wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      ORDER BY wallet
    `,
    format: 'JSONEachRow'
  });
  const benchmarks = await benchmarkResult.json() as BenchmarkRow[];

  // Filter to only CLOB wallets
  const clobBenchmarks = benchmarks.filter(b => !nonClobWallets.has(b.wallet.toLowerCase()));
  console.log('CLOB benchmark wallets to validate:', clobBenchmarks.length);

  const results: ValidationResult[] = [];
  let processed = 0;

  for (const benchmark of clobBenchmarks) {
    try {
      const pnl = await getWalletPnl(benchmark.wallet);
      const computedPnl = pnl.realized_pnl + pnl.unrealized_pnl;
      const uiPnl = benchmark.pnl_value;

      const absoluteError = Math.abs(computedPnl - uiPnl);
      const errorPct = uiPnl !== 0 ? (absoluteError / Math.abs(uiPnl)) * 100 : (computedPnl === 0 ? 0 : 100);

      results.push({
        wallet: benchmark.wallet,
        ui_pnl: uiPnl,
        computed_pnl: computedPnl,
        error_pct: errorPct,
        absolute_error: absoluteError
      });

      processed++;
      if (processed % 20 === 0) {
        console.log(`Processed ${processed}/${clobBenchmarks.length}...`);
      }
    } catch (error) {
      console.error(`Error processing ${benchmark.wallet}:`, error);
    }
  }

  // Sort by error percentage
  results.sort((a, b) => a.error_pct - b.error_pct);

  // Calculate statistics
  const avgError = results.reduce((sum, r) => sum + r.error_pct, 0) / results.length;
  const medianError = results[Math.floor(results.length / 2)].error_pct;
  const under10 = results.filter(r => r.error_pct < 10).length;
  const under20 = results.filter(r => r.error_pct < 20).length;
  const under50 = results.filter(r => r.error_pct < 50).length;

  console.log('\n=== CLOB-ONLY VALIDATION RESULTS ===');
  console.log(`Total CLOB wallets validated: ${results.length}`);
  console.log(`Average Error: ${avgError.toFixed(1)}%`);
  console.log(`Median Error: ${medianError.toFixed(1)}%`);
  console.log(`<10% error: ${under10}/${results.length} (${(under10/results.length*100).toFixed(0)}%)`);
  console.log(`<20% error: ${under20}/${results.length} (${(under20/results.length*100).toFixed(0)}%)`);
  console.log(`<50% error: ${under50}/${results.length} (${(under50/results.length*100).toFixed(0)}%)`);

  console.log('\n=== TOP 20 BEST MATCHES ===');
  results.slice(0, 20).forEach(r => {
    console.log(`  ${r.wallet.slice(0,10)}... UI: $${r.ui_pnl.toFixed(0)}, Computed: $${r.computed_pnl.toFixed(0)}, Error: ${r.error_pct.toFixed(1)}%`);
  });

  console.log('\n=== BOTTOM 10 WORST MATCHES ===');
  results.slice(-10).forEach(r => {
    console.log(`  ${r.wallet.slice(0,10)}... UI: $${r.ui_pnl.toFixed(0)}, Computed: $${r.computed_pnl.toFixed(0)}, Error: ${r.error_pct.toFixed(1)}%`);
  });

  await client.close();
}

main().catch(console.error);
