/**
 * Test PnL Engine V1 accuracy against pm_wallets_perfect_tier wallets
 *
 * 1. Get 20 random wallets from pm_wallets_perfect_tier with trade_count >= 30
 * 2. For each wallet, call getWalletPnLV1() and compare to Polymarket API
 * 3. Calculate error percentage: |V1 - PM| / |PM| * 100
 * 4. Report accuracy: how many are within 10% error
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { clickhouse } from '../lib/clickhouse/client';

interface WalletResult {
  wallet: string;
  v1Total: number;
  pmPnl: number | null;
  errorPct: number | null;
  within10Pct: boolean;
  confidence: string;
  bundledTxCount: number;
}

async function getPM(wallet: string): Promise<number | null> {
  try {
    const res = await fetch('https://user-pnl-api.polymarket.com/user-pnl?user_address=' + wallet);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
  } catch (e) {
    console.error(`Error fetching PM PnL for ${wallet}:`, e);
    return null;
  }
}

async function getRandomWallets(count: number): Promise<string[]> {
  const query = `
    SELECT wallet
    FROM pm_wallets_perfect_tier
    WHERE trade_count >= 30
    ORDER BY rand()
    LIMIT ${count}
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map(r => r.wallet);
}

function calculateErrorPct(v1: number, pm: number): number | null {
  if (pm === 0) {
    // If PM is 0 and V1 is also ~0, consider it a match
    if (Math.abs(v1) < 0.01) return 0;
    // Otherwise, can't calculate meaningful percentage
    return Math.abs(v1) * 100; // Treat as 100% per dollar off
  }
  return Math.abs(v1 - pm) / Math.abs(pm) * 100;
}

async function main() {
  console.log('Fetching 20 random wallets from pm_wallets_perfect_tier...\n');

  const wallets = await getRandomWallets(20);
  console.log(`Found ${wallets.length} wallets\n`);

  const results: WalletResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    console.log(`[${i + 1}/20] Processing ${wallet.slice(0, 10)}...`);

    try {
      // Get V1 PnL
      const v1Result = await getWalletPnLV1(wallet);

      // Get Polymarket API PnL
      const pmPnl = await getPM(wallet);

      // Calculate error
      const errorPct = pmPnl !== null ? calculateErrorPct(v1Result.total, pmPnl) : null;
      const within10Pct = errorPct !== null && errorPct <= 10;

      results.push({
        wallet,
        v1Total: v1Result.total,
        pmPnl,
        errorPct,
        within10Pct,
        confidence: v1Result.confidence,
        bundledTxCount: v1Result.bundledTxCount,
      });

      console.log(`   V1: $${v1Result.total.toFixed(2)}, PM: $${pmPnl?.toFixed(2) ?? 'N/A'}, Error: ${errorPct?.toFixed(1) ?? 'N/A'}%`);
    } catch (e) {
      console.error(`   Error processing wallet: ${e}`);
      results.push({
        wallet,
        v1Total: 0,
        pmPnl: null,
        errorPct: null,
        within10Pct: false,
        confidence: 'error',
        bundledTxCount: 0,
      });
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(100));

  // Print table header
  console.log('\n| Wallet | V1 PnL | PM PnL | Error % | Within 10% | Confidence | Bundled Txs |');
  console.log('|--------|--------|--------|---------|------------|------------|-------------|');

  for (const r of results) {
    const walletShort = r.wallet.slice(0, 10) + '...';
    const v1Str = r.v1Total >= 0 ? `$${r.v1Total.toFixed(2)}` : `-$${Math.abs(r.v1Total).toFixed(2)}`;
    const pmStr = r.pmPnl !== null ? (r.pmPnl >= 0 ? `$${r.pmPnl.toFixed(2)}` : `-$${Math.abs(r.pmPnl).toFixed(2)}`) : 'N/A';
    const errorStr = r.errorPct !== null ? `${r.errorPct.toFixed(1)}%` : 'N/A';
    const withinStr = r.within10Pct ? 'YES' : 'NO';

    console.log(`| ${walletShort} | ${v1Str.padStart(10)} | ${pmStr.padStart(10)} | ${errorStr.padStart(7)} | ${withinStr.padStart(10)} | ${r.confidence.padStart(10)} | ${String(r.bundledTxCount).padStart(11)} |`);
  }

  // Calculate stats
  const validResults = results.filter(r => r.errorPct !== null);
  const within10Count = validResults.filter(r => r.within10Pct).length;
  const within25Count = validResults.filter(r => r.errorPct !== null && r.errorPct <= 25).length;
  const within50Count = validResults.filter(r => r.errorPct !== null && r.errorPct <= 50).length;

  const avgError = validResults.length > 0
    ? validResults.reduce((sum, r) => sum + (r.errorPct || 0), 0) / validResults.length
    : 0;

  const medianError = validResults.length > 0
    ? [...validResults].sort((a, b) => (a.errorPct || 0) - (b.errorPct || 0))[Math.floor(validResults.length / 2)].errorPct
    : 0;

  console.log('\n' + '='.repeat(100));
  console.log('ACCURACY STATISTICS');
  console.log('='.repeat(100));
  console.log(`\nTotal wallets tested: ${results.length}`);
  console.log(`Valid comparisons: ${validResults.length}`);
  console.log(`\nWithin 10% error: ${within10Count}/${validResults.length} (${(within10Count/validResults.length*100).toFixed(1)}%)`);
  console.log(`Within 25% error: ${within25Count}/${validResults.length} (${(within25Count/validResults.length*100).toFixed(1)}%)`);
  console.log(`Within 50% error: ${within50Count}/${validResults.length} (${(within50Count/validResults.length*100).toFixed(1)}%)`);
  console.log(`\nAverage error: ${avgError.toFixed(1)}%`);
  console.log(`Median error: ${medianError?.toFixed(1)}%`);

  // Confidence breakdown
  const highConf = results.filter(r => r.confidence === 'high');
  const medConf = results.filter(r => r.confidence === 'medium');
  const lowConf = results.filter(r => r.confidence === 'low');

  console.log('\n' + '='.repeat(100));
  console.log('CONFIDENCE BREAKDOWN');
  console.log('='.repeat(100));
  console.log(`\nHigh confidence: ${highConf.length} wallets`);
  if (highConf.length > 0) {
    const highWithin10 = highConf.filter(r => r.within10Pct).length;
    console.log(`  - Within 10%: ${highWithin10}/${highConf.length} (${(highWithin10/highConf.length*100).toFixed(1)}%)`);
  }

  console.log(`\nMedium confidence: ${medConf.length} wallets`);
  if (medConf.length > 0) {
    const medWithin10 = medConf.filter(r => r.within10Pct).length;
    console.log(`  - Within 10%: ${medWithin10}/${medConf.length} (${(medWithin10/medConf.length*100).toFixed(1)}%)`);
  }

  console.log(`\nLow confidence: ${lowConf.length} wallets`);
  if (lowConf.length > 0) {
    const lowWithin10 = lowConf.filter(r => r.within10Pct).length;
    console.log(`  - Within 10%: ${lowWithin10}/${lowConf.length} (${(lowWithin10/lowConf.length*100).toFixed(1)}%)`);
  }

  process.exit(0);
}

main().catch(console.error);
