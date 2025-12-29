/**
 * Create Micro-Regression Test Set v1
 *
 * Selection criteria per Terminal 1 instructions:
 * - 3 CLOB-only wallets with Merge=0 (from previous benchmark passes)
 * - 3 CTF-active wallets with meaningful Merge/Split
 * - 2 high-volume Tier A winners
 * - 2 high-volume Tier A losers
 *
 * Save expected outputs for V12Synthetic, V12DomeCash, V12CashFull
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000,
});

interface RegressionWallet {
  wallet: string;
  category: 'clob_only' | 'ctf_active' | 'tier_a_winner' | 'tier_a_loser';
  notes: string;
  // Expected values (to be filled in after benchmark)
  expected_v12_synthetic?: number;
  expected_v12_dome_cash?: number;
  expected_v12_cash_full?: number;
  // Dome reference
  dome_realized?: number;
}

async function createMicroRegressionSet(): Promise<void> {
  console.log('='.repeat(80));
  console.log('MICRO-REGRESSION TEST SET BUILDER v1');
  console.log('='.repeat(80));
  console.log('');

  // Selection criteria
  const regressionSet: RegressionWallet[] = [];

  // 1. CLOB-only wallets with Merge=0 (from triple benchmark passes)
  // These should have: V12DomeCash = V12CashFull, and match Dome well
  const clobOnlyPasses = [
    {
      wallet: '0x199aefef3c9d89',
      dome_realized: 19222,
      notes: 'Pass with 0.6% error, CLOB-only',
    },
    {
      wallet: '0x258a6d3ff2acc5',
      dome_realized: 102200,
      notes: 'Pass with 0.0% error, CLOB-only (perfect match)',
    },
    {
      wallet: '0x7d725d21af52bb',
      dome_realized: 521,
      notes: 'Pass with 0.7% error, CLOB-only',
    },
  ];

  for (const w of clobOnlyPasses) {
    regressionSet.push({
      wallet: w.wallet,
      category: 'clob_only',
      notes: w.notes,
      dome_realized: w.dome_realized,
    });
  }

  console.log('Category 1: CLOB-only (Merge=0) wallets that pass Dome validation');
  clobOnlyPasses.forEach((w) => console.log(`  ${w.wallet} - ${w.notes}`));
  console.log('');

  // 2. CTF-active wallets with meaningful Merge/Split
  // Query for wallets with high merge activity
  const ctfActiveQuery = `
    SELECT
      wallet_address as wallet,
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PositionsMerge') as merge_events,
      round(sumIf(usdc_delta, source_type = 'PositionsMerge'), 2) as merge_usdc,
      round(sumIf(usdc_delta, source_type = 'CLOB'), 2) as clob_usdc
    FROM pm_unified_ledger_v8_tbl
    GROUP BY wallet_address
    HAVING
      merge_events > 1000
      AND clob_events >= 100
      AND abs(merge_usdc) > 10000
    ORDER BY merge_events DESC
    LIMIT 10
  `;

  console.log('Category 2: CTF-active wallets (significant Merge/Split)');
  const ctfResult = await ch.query({ query: ctfActiveQuery, format: 'JSONEachRow' });
  const ctfWallets = await ctfResult.json();

  // Pick 3 CTF-active wallets
  for (const w of ctfWallets.slice(0, 3)) {
    const wallet: RegressionWallet = {
      wallet: w.wallet,
      category: 'ctf_active',
      notes: `Merge events: ${w.merge_events}, Merge USDC: $${Math.round(w.merge_usdc).toLocaleString()}`,
    };
    regressionSet.push(wallet);
    console.log(`  ${w.wallet} - ${wallet.notes}`);
  }
  console.log('');

  // 3. High-volume Tier A winners (from existing benchmark data or query)
  console.log('Category 3: Tier A winners (high volume, positive PnL)');
  const tierAWinnersQuery = `
    SELECT
      wallet_address as wallet,
      countIf(source_type = 'CLOB') as clob_events,
      round(sum(usdc_delta), 2) as total_pnl
    FROM pm_unified_ledger_v8_tbl
    WHERE source_type IN ('CLOB', 'PayoutRedemption')
    GROUP BY wallet_address
    HAVING
      clob_events >= 1000
      AND total_pnl > 50000
    ORDER BY total_pnl DESC
    LIMIT 5
  `;

  const winnersResult = await ch.query({ query: tierAWinnersQuery, format: 'JSONEachRow' });
  const winners = await winnersResult.json();

  for (const w of winners.slice(0, 2)) {
    const wallet: RegressionWallet = {
      wallet: w.wallet,
      category: 'tier_a_winner',
      notes: `CLOB events: ${w.clob_events}, Total PnL: $${Math.round(w.total_pnl).toLocaleString()}`,
    };
    regressionSet.push(wallet);
    console.log(`  ${w.wallet} - ${wallet.notes}`);
  }
  console.log('');

  // 4. High-volume Tier A losers
  console.log('Category 4: Tier A losers (high volume, negative PnL)');
  const tierALosersQuery = `
    SELECT
      wallet_address as wallet,
      countIf(source_type = 'CLOB') as clob_events,
      round(sum(usdc_delta), 2) as total_pnl
    FROM pm_unified_ledger_v8_tbl
    WHERE source_type IN ('CLOB', 'PayoutRedemption')
    GROUP BY wallet_address
    HAVING
      clob_events >= 1000
      AND total_pnl < -50000
    ORDER BY total_pnl ASC
    LIMIT 5
  `;

  const losersResult = await ch.query({ query: tierALosersQuery, format: 'JSONEachRow' });
  const losers = await losersResult.json();

  for (const w of losers.slice(0, 2)) {
    const wallet: RegressionWallet = {
      wallet: w.wallet,
      category: 'tier_a_loser',
      notes: `CLOB events: ${w.clob_events}, Total PnL: $${Math.round(w.total_pnl).toLocaleString()}`,
    };
    regressionSet.push(wallet);
    console.log(`  ${w.wallet} - ${wallet.notes}`);
  }
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('MICRO-REGRESSION SET v1 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets: ${regressionSet.length}`);
  console.log(`  CLOB-only (Merge=0): ${regressionSet.filter((w) => w.category === 'clob_only').length}`);
  console.log(`  CTF-active: ${regressionSet.filter((w) => w.category === 'ctf_active').length}`);
  console.log(`  Tier A winners: ${regressionSet.filter((w) => w.category === 'tier_a_winner').length}`);
  console.log(`  Tier A losers: ${regressionSet.filter((w) => w.category === 'tier_a_loser').length}`);
  console.log('');

  // Save to file
  const outputPath = 'data/micro_regression_set_v1.json';

  // Create data directory if it doesn't exist
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
  }

  const output = {
    name: 'Micro-Regression Test Set v1',
    version: '1.0',
    created: new Date().toISOString(),
    description:
      'Fixed 10-wallet regression set for V12 realized PnL testing. Categories: CLOB-only, CTF-active, Tier A winners, Tier A losers.',
    wallets: regressionSet,
    // Format for benchmark script
    benchmark_format: regressionSet.map((w) => ({
      wallet_address: w.wallet,
      category: w.category,
      dome_realized: w.dome_realized,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Regression set saved to: ${outputPath}`);

  // Also save simple format for benchmark
  const benchmarkPath = 'tmp/micro_regression_benchmark.json';
  const benchmarkFormat = {
    wallets: regressionSet.map((w) => ({
      wallet_address: w.wallet,
      dome_realized: w.dome_realized,
    })),
  };
  fs.writeFileSync(benchmarkPath, JSON.stringify(benchmarkFormat, null, 2));
  console.log(`Benchmark file saved to: ${benchmarkPath}`);

  await ch.close();
}

createMicroRegressionSet().catch(console.error);
