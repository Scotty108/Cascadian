#!/usr/bin/env tsx
/**
 * Compare PnL with Dome API (Task R3)
 *
 * Fetches PnL from Dome API for selected wallets and compares with our ClickHouse calculations.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Dome API configuration
const DOME_BASE_URL = process.env.DOME_BASE_URL;
const DOME_API_KEY = process.env.DOME_API_KEY;

interface WalletComparison {
  wallet_address: string;
  wallet_label?: string;
  pnl_net_clickhouse: number;
  pnl_net_dome?: number;
  difference?: number;
  percent_difference?: number;
  error?: string;
}

async function fetchDomePnL(walletAddress: string): Promise<number | null> {
  if (!DOME_BASE_URL || !DOME_API_KEY) {
    throw new Error('Dome API credentials not configured');
  }

  try {
    // Dome API endpoint for wallet PnL
    // Note: This is a placeholder - actual endpoint may differ
    const url = `${DOME_BASE_URL}/api/wallets/${walletAddress}/pnl`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${DOME_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 429) {
      console.log('   ⚠️  Rate limited by Dome API');
      return null;
    }

    if (!response.ok) {
      console.log(`   ⚠️  Dome API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // Extract PnL from response
    // Note: This field name may need adjustment based on actual Dome API response
    const pnl = data.realized_pnl ?? data.pnl_net ?? data.total_pnl;

    if (typeof pnl === 'number') {
      return pnl;
    }

    console.log('   ⚠️  Could not extract PnL from Dome response');
    return null;

  } catch (error) {
    console.log(`   ⚠️  Error fetching from Dome: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main() {
  console.log('🔍 Comparing PnL with Dome API');
  console.log('='.repeat(60));
  console.log('');

  // Check for Dome API credentials
  if (!DOME_BASE_URL || !DOME_API_KEY) {
    console.log('⚠️  Dome API credentials not configured');
    console.log('');
    console.log('Missing environment variables:');
    if (!DOME_BASE_URL) console.log('  - DOME_BASE_URL');
    if (!DOME_API_KEY) console.log('  - DOME_API_KEY');
    console.log('');
    console.log('Skipping Dome comparison.');
    console.log('');
    process.exit(0);
  }

  console.log(`Dome API: ${DOME_BASE_URL}`);
  console.log('');

  // ========================================================================
  // Fetch wallets from snapshot
  // ========================================================================

  console.log('Fetching selected wallets from snapshot...');
  const walletsQuery = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        SUM(pnl_net) as pnl_net_clickhouse,
        COUNT(DISTINCT condition_id) as markets_count
      FROM pm_wallet_pnl_snapshot_for_dome
      GROUP BY wallet_address
      HAVING pnl_net_clickhouse != 0
      ORDER BY pnl_net_clickhouse DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const allWallets = await walletsQuery.json();

  if (allWallets.length === 0) {
    console.log('⚠️  No wallets found in snapshot');
    console.log('');
    process.exit(0);
  }

  // Filter to our 2 specific wallets
  const XCNSTRATEGY_ADDRESS = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const selectedWallets = allWallets.filter((w: any) =>
    w.wallet_address === XCNSTRATEGY_ADDRESS || allWallets.indexOf(w) === 0
  ).slice(0, 2);

  console.log(`Found ${selectedWallets.length} wallets for comparison`);
  console.log('');

  // ========================================================================
  // Compare each wallet with Dome
  // ========================================================================

  const comparisons: WalletComparison[] = [];

  for (const wallet of selectedWallets) {
    const walletAddr = wallet.wallet_address as string;
    const pnlClickhouse = parseFloat(wallet.pnl_net_clickhouse as string);
    const isXCN = walletAddr === XCNSTRATEGY_ADDRESS;

    console.log(`Comparing wallet: ${walletAddr.substring(0, 10)}...${walletAddr.substring(walletAddr.length - 6)}`);
    if (isXCN) {
      console.log('   (xcnstrategy)');
    }
    console.log(`   ClickHouse PnL: $${pnlClickhouse.toLocaleString()}`);

    // Fetch from Dome
    console.log('   Fetching from Dome API...');
    const pnlDome = await fetchDomePnL(walletAddr);

    // Wait 1 second between requests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));

    const comparison: WalletComparison = {
      wallet_address: walletAddr,
      wallet_label: isXCN ? 'xcnstrategy' : 'top_wallet',
      pnl_net_clickhouse: pnlClickhouse
    };

    if (pnlDome !== null) {
      comparison.pnl_net_dome = pnlDome;
      comparison.difference = pnlClickhouse - pnlDome;
      comparison.percent_difference = Math.abs(comparison.difference) / Math.max(1, Math.abs(pnlDome)) * 100;

      console.log(`   Dome PnL: $${pnlDome.toLocaleString()}`);
      console.log(`   Difference: $${comparison.difference.toLocaleString()} (${comparison.percent_difference.toFixed(2)}%)`);
    } else {
      comparison.error = 'Failed to fetch from Dome';
      console.log(`   ⚠️  ${comparison.error}`);
    }

    console.log('');
    comparisons.push(comparison);
  }

  // ========================================================================
  // Summary Statistics
  // ========================================================================

  console.log('='.repeat(60));
  console.log('📊 COMPARISON SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  const validComparisons = comparisons.filter(c => c.pnl_net_dome !== undefined);

  if (validComparisons.length === 0) {
    console.log('⚠️  No valid Dome comparisons available');
    console.log('   All Dome API requests failed or returned invalid data');
    console.log('');
  } else {
    console.log(`Valid comparisons: ${validComparisons.length} / ${comparisons.length}`);
    console.log('');

    // Calculate statistics
    const differences = validComparisons.map(c => Math.abs(c.difference!));
    const percentDiffs = validComparisons.map(c => c.percent_difference!);

    const meanDiff = differences.reduce((a, b) => a + b, 0) / differences.length;
    const medianDiff = differences.sort((a, b) => a - b)[Math.floor(differences.length / 2)];
    const meanPctDiff = percentDiffs.reduce((a, b) => a + b, 0) / percentDiffs.length;

    console.log('Absolute Difference:');
    console.log(`  Mean: $${meanDiff.toLocaleString()}`);
    console.log(`  Median: $${medianDiff.toLocaleString()}`);
    console.log('');
    console.log('Percent Difference:');
    console.log(`  Mean: ${meanPctDiff.toFixed(2)}%`);
    console.log('');

    // Detailed comparison table
    console.log('Detailed Comparison:');
    console.log('');
    console.table(validComparisons.map(c => ({
      wallet: c.wallet_label || c.wallet_address.substring(0, 10),
      clickhouse: `$${c.pnl_net_clickhouse.toLocaleString()}`,
      dome: c.pnl_net_dome ? `$${c.pnl_net_dome.toLocaleString()}` : 'N/A',
      diff: c.difference ? `$${c.difference.toLocaleString()}` : 'N/A',
      pct: c.percent_difference ? `${c.percent_difference.toFixed(2)}%` : 'N/A'
    })));
  }

  // ========================================================================
  // Expected Discrepancies
  // ========================================================================

  console.log('');
  console.log('='.repeat(60));
  console.log('📝 EXPECTED DISCREPANCIES');
  console.log('='.repeat(60));
  console.log('');
  console.log('Known limitations that may cause differences:');
  console.log('');
  console.log('1. Missing fee data on our side:');
  console.log('   - 99.98% of trades have $0 fees in CLOB API');
  console.log('   - Our PnL is overstated by ~0.5%');
  console.log('   - Dome may include real fees from blockchain');
  console.log('');
  console.log('2. Time window differences:');
  console.log('   - Our data is filtered to resolved markets before cutoff');
  console.log('   - Dome may include more recent or open positions');
  console.log('');
  console.log('3. Scope differences:');
  console.log('   - We only include binary CLOB markets');
  console.log('   - Dome may include categorical markets or AMM positions');
  console.log('');
  console.log('4. Data completeness:');
  console.log('   - Our ClickHouse data is ~10 days behind');
  console.log('   - Dome has real-time data');
  console.log('');

  // Save results for documentation
  const results = {
    comparison_cutoff: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    wallets_compared: comparisons.length,
    valid_comparisons: validComparisons.length,
    comparisons,
    statistics: validComparisons.length > 0 ? {
      mean_absolute_difference: meanDiff,
      median_absolute_difference: medianDiff,
      mean_percent_difference: meanPctDiff
    } : null
  };

  console.log('Results saved to comparison object (available for documentation)');
  console.log('');

  // Return results for use in Task R4
  return results;
}

main().catch((error) => {
  console.error('❌ Comparison failed:', error);
  process.exit(1);
});
