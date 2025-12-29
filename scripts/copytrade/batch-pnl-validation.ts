/**
 * Batch P&L Validation
 *
 * Test our engine against a larger sample of wallets to find patterns in error rates.
 * Uses browser automation to fetch live UI P&L values.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeLedgerV2Pnl } from '@/lib/pnl/ledgerV2';
import { clickhouse } from '@/lib/clickhouse/client';

// Sample wallets with varying patterns
const TEST_WALLETS = [
  // Known test wallets
  { address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', name: 'calibration' },
  { address: '0x0d0e73b88444c21094421447451e15e9c4f14049', name: 'alexma11224' },
  { address: '0xfb328b94ed05115259bbc48ba8182df1416edb85', name: 'winner1' },
];

interface ValidationResult {
  wallet: string;
  name: string;
  enginePnl: number;
  pattern: string;
  mappingPct: number;
  buys: number;
  sells: number;
  redemptions: number;
  splitCost: number;
  heldValue: number;
}

async function getMoreWallets(): Promise<Array<{ address: string; name: string }>> {
  // Get wallets with significant trading activity from different patterns
  const q = `
    WITH wallet_stats AS (
      SELECT
        trader_wallet,
        sum(usdc_amount)/1e6 as total_volume,
        sumIf(token_amount, side = 'buy')/1e6 as tokens_bought,
        sumIf(token_amount, side = 'sell')/1e6 as tokens_sold,
        count() as trade_count
      FROM pm_trader_events_dedup_v2_tbl
      GROUP BY trader_wallet
      HAVING trade_count > 100 AND total_volume > 1000
    )
    SELECT
      trader_wallet as address,
      total_volume,
      tokens_bought,
      tokens_sold,
      tokens_bought - tokens_sold as net_tokens,
      if(tokens_bought > tokens_sold, 'BUYER', 'SELLER') as pattern
    FROM wallet_stats
    ORDER BY rand()
    LIMIT 20
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as Array<{
    address: string;
    total_volume: number;
    net_tokens: number;
    pattern: string;
  }>;

  return rows.map((r, i) => ({
    address: r.address,
    name: `sample_${i + 1}_${r.pattern.toLowerCase()}`,
  }));
}

async function main() {
  console.log('=== BATCH P&L VALIDATION ===\n');

  // Get additional wallets to test
  console.log('Fetching sample wallets...');
  const sampleWallets = await getMoreWallets();
  const allWallets = [...TEST_WALLETS, ...sampleWallets];

  console.log(`Testing ${allWallets.length} wallets...\n`);

  const results: ValidationResult[] = [];

  for (const wallet of allWallets) {
    try {
      const result = await computeLedgerV2Pnl(wallet.address);
      results.push({
        wallet: wallet.address,
        name: wallet.name,
        enginePnl: result.realizedPnl,
        pattern: result.isNetBuyer ? 'BUYER' : 'SELLER',
        mappingPct: result.mappingCoveragePct * 100,
        buys: result.buys,
        sells: result.sells,
        redemptions: result.redemptions,
        splitCost: result.splitCost,
        heldValue: result.heldValue,
      });
      process.stdout.write('.');
    } catch (err) {
      console.error(`\nError for ${wallet.name}: ${err}`);
    }
  }
  console.log('\n');

  // Analyze patterns
  console.log('=== RESULTS BY PATTERN ===\n');

  const buyers = results.filter((r) => r.pattern === 'BUYER');
  const sellers = results.filter((r) => r.pattern === 'SELLER');

  console.log(`BUYERS (${buyers.length} wallets):`);
  console.log('Name                  | Engine P&L   | Mapping% | Buys      | Sells     | Redeem    | Split     | Held');
  console.log('-'.repeat(120));
  for (const r of buyers.slice(0, 15)) {
    console.log(
      `${r.name.padEnd(21)} | ` +
        `$${r.enginePnl.toFixed(0).padStart(10)} | ` +
        `${r.mappingPct.toFixed(0).padStart(6)}% | ` +
        `$${r.buys.toFixed(0).padStart(8)} | ` +
        `$${r.sells.toFixed(0).padStart(8)} | ` +
        `$${r.redemptions.toFixed(0).padStart(8)} | ` +
        `$${r.splitCost.toFixed(0).padStart(8)} | ` +
        `$${r.heldValue.toFixed(0).padStart(8)}`
    );
  }

  console.log(`\nSELLERS (${sellers.length} wallets):`);
  console.log('Name                  | Engine P&L   | Mapping% | Buys      | Sells     | Redeem    | Split     | Held');
  console.log('-'.repeat(120));
  for (const r of sellers.slice(0, 15)) {
    console.log(
      `${r.name.padEnd(21)} | ` +
        `$${r.enginePnl.toFixed(0).padStart(10)} | ` +
        `${r.mappingPct.toFixed(0).padStart(6)}% | ` +
        `$${r.buys.toFixed(0).padStart(8)} | ` +
        `$${r.sells.toFixed(0).padStart(8)} | ` +
        `$${r.redemptions.toFixed(0).padStart(8)} | ` +
        `$${r.splitCost.toFixed(0).padStart(8)} | ` +
        `$${r.heldValue.toFixed(0).padStart(8)}`
    );
  }

  // Summary stats
  console.log('\n=== SUMMARY STATS ===\n');

  const positivePnl = results.filter((r) => r.enginePnl > 0);
  const negativePnl = results.filter((r) => r.enginePnl < 0);

  console.log(`Total wallets: ${results.length}`);
  console.log(`Positive P&L: ${positivePnl.length} (${((positivePnl.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`Negative P&L: ${negativePnl.length} (${((negativePnl.length / results.length) * 100).toFixed(0)}%)`);

  console.log(`\nBy pattern:`);
  console.log(`  BUYERS: ${buyers.length} wallets`);
  console.log(`    Positive: ${buyers.filter((r) => r.enginePnl > 0).length}`);
  console.log(`    Negative: ${buyers.filter((r) => r.enginePnl < 0).length}`);
  console.log(`  SELLERS: ${sellers.length} wallets`);
  console.log(`    Positive: ${sellers.filter((r) => r.enginePnl > 0).length}`);
  console.log(`    Negative: ${sellers.filter((r) => r.enginePnl < 0).length}`);

  // Average mapping coverage
  const avgMapping = results.reduce((sum, r) => sum + r.mappingPct, 0) / results.length;
  console.log(`\nAverage mapping coverage: ${avgMapping.toFixed(1)}%`);

  // Output for further analysis
  console.log('\n=== RAW DATA FOR UI COMPARISON ===');
  console.log('Copy these addresses to check UI P&L:\n');
  for (const r of results.slice(0, 10)) {
    console.log(`${r.name}: ${r.wallet}`);
    console.log(`  Engine P&L: $${r.enginePnl.toFixed(2)}`);
    console.log(`  Pattern: ${r.pattern}, Mapping: ${r.mappingPct.toFixed(0)}%`);
    console.log('');
  }
}

main().catch(console.error);
