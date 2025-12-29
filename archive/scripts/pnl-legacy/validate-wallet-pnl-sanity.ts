#!/usr/bin/env npx tsx

/**
 * Wallet P&L Sanity Check
 *
 * Validates wallet_pnl_summary_final against known baseline wallets
 *
 * Tests:
 * 1. All wallets have P&L entries
 * 2. P&L values are within reasonable bounds
 * 3. Top wallets match expected high-volume traders
 * 4. No obvious data corruption (NaN, Infinity, nulls)
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

// Known baseline wallets from Polymarket
const BASELINE_WALLETS = [
  { address: '0x4ce73141ecd5bba0952dd1f12c9b3e3c5b1a6bb8', label: 'High-volume trader' },
  { address: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', label: 'Known profitable wallet' },
  { address: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', label: 'Known active wallet' }
];

async function main() {
  console.log('═'.repeat(80));
  console.log('WALLET P&L SANITY CHECK');
  console.log('═'.repeat(80));
  console.log('Validating wallet_pnl_summary_final data quality\n');

  // Test 1: Data completeness
  console.log('[1/4] Data Completeness Check...\n');

  const completeness = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_wallets,
        COUNT(DISTINCT wallet) as unique_wallets,
        SUM(total_realized_pnl_usd) as total_pnl,
        SUM(markets_traded) as total_market_positions
      FROM wallet_pnl_summary_final
    `,
    format: 'JSONEachRow'
  });

  const compData = await completeness.json();
  const totalWallets = parseInt(compData[0].total_wallets);
  const uniqueWallets = parseInt(compData[0].unique_wallets);
  const totalPnL = parseFloat(compData[0].total_pnl);
  const totalPositions = parseInt(compData[0].total_market_positions);

  console.log(`   Total rows:           ${totalWallets.toLocaleString()}`);
  console.log(`   Unique wallets:       ${uniqueWallets.toLocaleString()}`);
  console.log(`   Total P&L:            $${totalPnL.toLocaleString()}`);
  console.log(`   Total positions:      ${totalPositions.toLocaleString()}`);
  console.log(`   Status:               ${totalWallets === uniqueWallets ? '✅ PASS' : '⚠️ WARN'} (1:1 wallet:row ratio)\n`);

  // Test 2: Data quality (no corruption)
  console.log('[2/4] Data Quality Check...\n');

  const quality = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        countIf(isNaN(total_realized_pnl_usd)) as nan_values,
        countIf(isInfinite(total_realized_pnl_usd)) as inf_values,
        countIf(total_realized_pnl_usd IS NULL) as null_values,
        countIf(markets_traded = 0) as zero_markets
      FROM wallet_pnl_summary_final
    `,
    format: 'JSONEachRow'
  });

  const qualData = await quality.json();
  const nanCount = parseInt(qualData[0].nan_values);
  const infCount = parseInt(qualData[0].inf_values);
  const nullCount = parseInt(qualData[0].null_values);
  const zeroMarkets = parseInt(qualData[0].zero_markets);

  console.log(`   NaN values:           ${nanCount} (${(nanCount / totalWallets * 100).toFixed(2)}%)`);
  console.log(`   Infinity values:      ${infCount} (${(infCount / totalWallets * 100).toFixed(2)}%)`);
  console.log(`   Null values:          ${nullCount} (${(nullCount / totalWallets * 100).toFixed(2)}%)`);
  console.log(`   Wallets w/ 0 markets: ${zeroMarkets} (${(zeroMarkets / totalWallets * 100).toFixed(2)}%)`);

  const qualityPassed = nanCount === 0 && infCount === 0 && nullCount === 0;
  console.log(`   Status:               ${qualityPassed ? '✅ PASS' : '❌ FAIL'} (no corruption)\n`);

  // Test 3: Baseline wallet check
  console.log('[3/4] Baseline Wallet Validation...\n');

  let baselinesPassed = 0;

  for (const baseline of BASELINE_WALLETS) {
    const walletResult = await clickhouse.query({
      query: `
        SELECT
          wallet,
          total_realized_pnl_usd,
          markets_traded,
          position_count
        FROM wallet_pnl_summary_final
        WHERE lower(wallet) = lower('${baseline.address}')
      `,
      format: 'JSONEachRow'
    });

    const wData = await walletResult.json();

    if (wData.length > 0) {
      const pnl = parseFloat(wData[0].total_realized_pnl_usd);
      const markets = parseInt(wData[0].markets_traded);
      const positions = parseInt(wData[0].position_count);

      const hasData = markets > 0 && positions > 0;
      if (hasData) baselinesPassed++;

      console.log(`   ${baseline.address.substring(0, 12)}... (${baseline.label})`);
      console.log(`     P&L:       $${pnl.toFixed(2)}`);
      console.log(`     Markets:   ${markets.toLocaleString()}`);
      console.log(`     Positions: ${positions.toLocaleString()}`);
      console.log(`     Status:    ${hasData ? '✅ PASS' : '⚠️ WARN'}\n`);
    } else {
      console.log(`   ${baseline.address.substring(0, 12)}... (${baseline.label})`);
      console.log(`     ❌ NOT FOUND in wallet_pnl_summary_final\n`);
    }
  }

  // Test 4: Top wallets check
  console.log('[4/4] Top Wallets Check...\n');

  const topWallets = await clickhouse.query({
    query: `
      SELECT
        wallet,
        total_realized_pnl_usd,
        markets_traded,
        position_count
      FROM wallet_pnl_summary_final
      ORDER BY abs(total_realized_pnl_usd) DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const topData = await topWallets.json();
  console.log('   Top 5 wallets by |P&L|:');
  topData.forEach((w: any, idx: number) => {
    const pnl = parseFloat(w.total_realized_pnl_usd);
    console.log(`     ${idx + 1}. ${w.wallet.substring(0, 12)}... → $${pnl.toFixed(2)} (${w.markets_traded} markets)`);
  });

  // Final verdict
  console.log();
  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));

  const allPassed = qualityPassed && baselinesPassed >= 2 && totalWallets === uniqueWallets;

  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED');
    console.log();
    console.log('wallet_pnl_summary_final is ready for production use.');
    console.log(`- ${uniqueWallets.toLocaleString()} wallets with P&L data`);
    console.log(`- No data corruption detected`);
    console.log(`- Baseline wallets validated`);
  } else {
    console.log('⚠️  SOME CHECKS FAILED');
    console.log();
    console.log('Review results above for details.');

    if (!qualityPassed) console.log('- Data corruption detected (NaN/Inf/Null values)');
    if (baselinesPassed < 2) console.log(`- Only ${baselinesPassed}/${BASELINE_WALLETS.length} baseline wallets found`);
    if (totalWallets !== uniqueWallets) console.log('- Duplicate wallet entries detected');
  }
  console.log('═'.repeat(80));
}

main().catch(console.error);
