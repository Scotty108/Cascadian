#!/usr/bin/env npx tsx
import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

interface BaselineWallet {
  wallet: string;
  expected_pnl: number;
}

(async () => {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('DIRECT P&L VALIDATION (No Fallbacks)');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // Load expected values from CSV
  const csvContent = fs.readFileSync('tmp/omega-baseline-2025-11-11.csv', 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header

  const expectedWallets: BaselineWallet[] = lines
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split(',');
      return {
        wallet: parts[0],
        expected_pnl: parseFloat(parts[1])
      };
    });

  console.log(`Loaded ${expectedWallets.length} baseline wallets\n`);
  console.log('Querying realized_pnl_by_market_final directly...\n');

  // Query P&L directly from the table
  const walletList = expectedWallets.map(w => `'${w.wallet}'`).join(', ');

  const result = await clickhouse.query({
    query: `
      SELECT
        wallet,
        SUM(realized_pnl_usd) as total_pnl
      FROM realized_pnl_by_market_final
      WHERE wallet IN (${walletList})
      GROUP BY wallet
      ORDER BY wallet
    `,
    format: 'JSONEachRow'
  });

  const actualData = await result.json();

  console.log('═'.repeat(80));
  console.log('VALIDATION RESULTS');
  console.log('═'.repeat(80) + '\n');

  let totalVariance = 0;
  let walletsWithVariance = 0;

  for (const expected of expectedWallets) {
    const actual = actualData.find(a => a.wallet.toLowerCase() === expected.wallet.toLowerCase());

    if (!actual) {
      console.log(`❌ ${expected.wallet.substring(0, 12)}... - NO DATA IN P&L TABLE`);
      walletsWithVariance++;
      continue;
    }

    const actualPnl = parseFloat(actual.total_pnl);
    const expectedPnl = expected.expected_pnl;
    const delta = actualPnl - expectedPnl;
    const deltaPct = (delta / Math.abs(expectedPnl)) * 100;

    totalVariance += Math.abs(deltaPct);

    if (Math.abs(deltaPct) > 1) {
      walletsWithVariance++;
    }

    const statusIcon = Math.abs(deltaPct) <= 1 ? '✅' : (Math.abs(deltaPct) <= 50 ? '⚠️' : '❌');

    console.log(`${statusIcon} ${expected.wallet.substring(0, 12)}...`);
    console.log(`   Expected: $${expectedPnl.toLocaleString()}`);
    console.log(`   Actual:   $${actualPnl.toLocaleString()}`);
    console.log(`   Delta:    $${delta.toLocaleString()} (${deltaPct.toFixed(1)}%)`);
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total wallets:              ${expectedWallets.length}`);
  console.log(`Wallets with >1% variance:  ${walletsWithVariance}`);
  console.log(`Wallets passing (<1%):      ${expectedWallets.length - walletsWithVariance}`);
  console.log(`Average absolute variance:  ${(totalVariance / expectedWallets.length).toFixed(1)}%`);
  console.log('═'.repeat(80) + '\n');

  if (walletsWithVariance === 0) {
    console.log('✅ ALL WALLETS WITHIN 1% TOLERANCE - VALIDATION PASSED!\n');
  } else {
    console.log('⚠️  VALIDATION FAILED - Root cause investigation needed\n');
    console.log('Likely issues:');
    console.log('  1. Magnitude inflation (6-15x) - unresolved markets included?');
    console.log('  2. Some wallets still negative - sign fix incomplete?');
    console.log('  3. Fee handling incorrect?');
    console.log('  4. Payout vector calculation wrong?\n');
  }
})().catch(console.error);
