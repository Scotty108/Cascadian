#!/usr/bin/env npx tsx

/**
 * ERC-1155 Volume Parity Check
 *
 * Validates that CLOB fills align with ERC-1155 transfer volumes
 *
 * Test: Compare aggregate share volumes between:
 * - clob_fills (order book trades)
 * - erc1155_transfers (blockchain token transfers)
 *
 * Expected: <5% variance (some fills may be off-chain, some transfers may be non-trade)
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('═'.repeat(80));
  console.log('ERC-1155 VOLUME PARITY CHECK');
  console.log('═'.repeat(80));
  console.log('Comparing CLOB fills vs blockchain transfers\n');

  // Test 1: Total volume comparison
  console.log('[1/3] Total Volume Comparison...\n');

  const volumeResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT SUM(size) FROM clob_fills) as clob_volume,
        (SELECT SUM(toFloat64(value)) FROM erc1155_transfers) as erc_volume
    `,
    format: 'JSONEachRow'
  });

  const volData = await volumeResult.json();
  const clobVol = parseFloat(volData[0].clob_volume);
  const ercVol = parseFloat(volData[0].erc_volume);
  const volVariance = Math.abs((clobVol - ercVol) / ercVol * 100);

  console.log(`   CLOB fills total volume:      ${clobVol.toLocaleString()} shares`);
  console.log(`   ERC-1155 total volume:        ${ercVol.toLocaleString()} shares`);
  console.log(`   Variance:                     ${volVariance.toFixed(2)}%`);
  console.log(`   Status:                       ${volVariance < 5 ? '✅ PASS' : '⚠️ WARN'} (threshold: <5%)\n`);

  // Test 2: Market-level coverage
  console.log('[2/3] Market Coverage Comparison...\n');

  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(DISTINCT condition_id) FROM clob_fills) as clob_markets,
        (SELECT COUNT(DISTINCT condition_id) FROM erc1155_transfers WHERE condition_id != '') as erc_markets
    `,
    format: 'JSONEachRow'
  });

  const covData = await coverageResult.json();
  const clobMarkets = parseInt(covData[0].clob_markets);
  const ercMarkets = parseInt(covData[0].erc_markets);
  const marketRatio = (clobMarkets / ercMarkets * 100);

  console.log(`   Markets with CLOB fills:      ${clobMarkets.toLocaleString()}`);
  console.log(`   Markets with ERC-1155:        ${ercMarkets.toLocaleString()}`);
  console.log(`   Coverage ratio:               ${marketRatio.toFixed(1)}%`);
  console.log(`   Status:                       ${marketRatio > 80 ? '✅ PASS' : '⚠️ WARN'} (threshold: >80%)\n`);

  // Test 3: Known wallet volume check
  console.log('[3/3] Known Wallet Volume Check...\n');

  const testWallets = [
    '0x4ce73141ecd5bba0952dd1f12c9b3e3c5b1a6bb8',
    '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
  ];

  let walletsPassed = 0;

  for (const wallet of testWallets) {
    const walletResult = await clickhouse.query({
      query: `
        SELECT
          (SELECT SUM(size) FROM clob_fills WHERE lower(proxy_wallet) = lower('${wallet}')) as clob_vol,
          (SELECT SUM(toFloat64(value)) FROM erc1155_transfers WHERE lower(wallet_address) = lower('${wallet}')) as erc_vol
      `,
      format: 'JSONEachRow'
    });

    const wData = await walletResult.json();
    const wClobVol = parseFloat(wData[0].clob_vol || '0');
    const wErcVol = parseFloat(wData[0].erc_vol || '0');
    const wVariance = wErcVol > 0 ? Math.abs((wClobVol - wErcVol) / wErcVol * 100) : 0;
    const passed = wVariance < 10;

    if (passed) walletsPassed++;

    console.log(`   ${wallet.substring(0, 12)}...`);
    console.log(`     CLOB volume:   ${wClobVol.toLocaleString()}`);
    console.log(`     ERC-1155:      ${wErcVol.toLocaleString()}`);
    console.log(`     Variance:      ${wVariance.toFixed(2)}%`);
    console.log(`     Status:        ${passed ? '✅ PASS' : '⚠️ WARN'}\n`);
  }

  // Final verdict
  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));

  const allPassed = volVariance < 5 && marketRatio > 80 && walletsPassed === testWallets.length;

  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED');
    console.log();
    console.log('CLOB fills and ERC-1155 transfers show acceptable parity.');
    console.log('Data quality sufficient for P&L calculations.');
  } else {
    console.log('⚠️  SOME CHECKS FAILED');
    console.log();
    console.log('Review variance details above.');
    console.log('Note: Some variance expected (off-chain settlements, non-trade transfers)');
  }
  console.log('═'.repeat(80));
}

main().catch(console.error);
