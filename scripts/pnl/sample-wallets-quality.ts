/**
 * Sample Wallets Quality Check
 *
 * Samples 100 random wallets from CLOB and determines what percentage
 * have complete fills data (i.e., fills-only PnL is valid).
 *
 * Classifications:
 * - TRADER_OK: Fills are complete, can use fills-only PnL
 * - TRADER_INCOMPLETE: Has CLOB trades but fills are incomplete
 * - NON_TRADER: No CLOB trades found
 *
 * Usage:
 *   npx tsx scripts/pnl/sample-wallets-quality.ts
 *   npx tsx scripts/pnl/sample-wallets-quality.ts --count 200
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { checkWalletFillsCompleteness, FillsCompletenessResult } from './check-fills-completeness';

interface WalletQualityResult extends FillsCompletenessResult {
  classification: 'TRADER_OK' | 'TRADER_INCOMPLETE' | 'NON_TRADER';
  clobTradeCount: number;
  totalUsdcVolume: number;
}

async function getRandomWallets(count: number): Promise<string[]> {
  // Get random wallets that have CLOB trades
  // Using SAMPLE BY with a hash function for random selection
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT trader_wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trader_wallet != ''
        AND trader_wallet IS NOT NULL
      ORDER BY cityHash64(trader_wallet)
      LIMIT ${count}
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  return rows.map((r) => r.trader_wallet);
}

async function getWalletStats(wallet: string): Promise<{ tradeCount: number; usdcVolume: number }> {
  const walletLower = wallet.toLowerCase();
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as trade_count,
        sum(usdc_amount) / 1e6 as usdc_volume
      FROM (
        SELECT event_id, any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${walletLower}'
          AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });

  const row = (await result.json())[0] as any;
  return {
    tradeCount: Number(row?.trade_count || 0),
    usdcVolume: Number(row?.usdc_volume || 0),
  };
}

async function checkWalletQuality(wallet: string, index: number): Promise<WalletQualityResult> {
  // Get basic stats
  const stats = await getWalletStats(wallet);

  if (stats.tradeCount === 0) {
    return {
      wallet,
      name: `Wallet ${index}`,
      fillsComplete: false,
      totalPositions: 0,
      badPositions: 0,
      worstTokenDiff: 0,
      clobOnlyTokens: 0,
      ledgerTokens: 0,
      netDifference: 0,
      reason: 'No CLOB trades',
      classification: 'NON_TRADER',
      clobTradeCount: 0,
      totalUsdcVolume: 0,
    };
  }

  // Run fills completeness check
  const fillsResult = await checkWalletFillsCompleteness(wallet, `Wallet ${index}`);

  let classification: 'TRADER_OK' | 'TRADER_INCOMPLETE' | 'NON_TRADER';
  if (fillsResult.totalPositions === 0) {
    classification = 'NON_TRADER';
  } else if (fillsResult.fillsComplete) {
    classification = 'TRADER_OK';
  } else {
    classification = 'TRADER_INCOMPLETE';
  }

  return {
    ...fillsResult,
    classification,
    clobTradeCount: stats.tradeCount,
    totalUsdcVolume: stats.usdcVolume,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf('--count');
  const sampleSize = countIdx !== -1 && args[countIdx + 1] ? parseInt(args[countIdx + 1]) : 100;

  console.log('═'.repeat(70));
  console.log('WALLET QUALITY SAMPLING');
  console.log('═'.repeat(70));
  console.log(`\nSampling ${sampleSize} random wallets from CLOB data...\n`);

  // Get random wallets
  const wallets = await getRandomWallets(sampleSize);
  console.log(`Found ${wallets.length} wallets to check.\n`);

  const results: WalletQualityResult[] = [];
  const startTime = Date.now();

  // Process wallets with progress indicator
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    process.stdout.write(`\rProcessing wallet ${i + 1}/${wallets.length}...`);

    try {
      const result = await checkWalletQuality(wallet, i + 1);
      results.push(result);
    } catch (err: any) {
      console.error(`\nError checking wallet ${wallet}: ${err.message}`);
      results.push({
        wallet,
        name: `Wallet ${i + 1}`,
        fillsComplete: false,
        totalPositions: 0,
        badPositions: 0,
        worstTokenDiff: 0,
        clobOnlyTokens: 0,
        ledgerTokens: 0,
        netDifference: 0,
        reason: `Error: ${err.message}`,
        classification: 'TRADER_INCOMPLETE',
        clobTradeCount: 0,
        totalUsdcVolume: 0,
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nCompleted in ${elapsed}s\n`);

  // Calculate statistics
  const traderOk = results.filter((r) => r.classification === 'TRADER_OK');
  const traderIncomplete = results.filter((r) => r.classification === 'TRADER_INCOMPLETE');
  const nonTrader = results.filter((r) => r.classification === 'NON_TRADER');

  // Calculate volume-weighted coverage
  const okVolume = traderOk.reduce((sum, r) => sum + r.totalUsdcVolume, 0);
  const incompleteVolume = traderIncomplete.reduce((sum, r) => sum + r.totalUsdcVolume, 0);
  const totalVolume = okVolume + incompleteVolume;

  // Print summary
  console.log('─'.repeat(70));
  console.log('SUMMARY');
  console.log('─'.repeat(70));
  console.log('');
  console.log('Classification'.padEnd(25) + ' | ' + 'Count'.padStart(6) + ' | ' + 'Pct'.padStart(6) + ' | ' + 'Volume'.padStart(15));
  console.log('-'.repeat(70));
  console.log(
    'TRADER_OK (fills OK)'.padEnd(25) +
      ' | ' +
      String(traderOk.length).padStart(6) +
      ' | ' +
      ((traderOk.length / results.length) * 100).toFixed(1).padStart(5) +
      '%' +
      ' | ' +
      ('$' + okVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })).padStart(15)
  );
  console.log(
    'TRADER_INCOMPLETE'.padEnd(25) +
      ' | ' +
      String(traderIncomplete.length).padStart(6) +
      ' | ' +
      ((traderIncomplete.length / results.length) * 100).toFixed(1).padStart(5) +
      '%' +
      ' | ' +
      ('$' + incompleteVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })).padStart(15)
  );
  console.log(
    'NON_TRADER'.padEnd(25) +
      ' | ' +
      String(nonTrader.length).padStart(6) +
      ' | ' +
      ((nonTrader.length / results.length) * 100).toFixed(1).padStart(5) +
      '%' +
      ' | ' +
      '$0'.padStart(15)
  );
  console.log('-'.repeat(70));
  console.log(
    'TOTAL'.padEnd(25) +
      ' | ' +
      String(results.length).padStart(6) +
      ' | ' +
      '100.0%'.padStart(6) +
      ' | ' +
      ('$' + totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })).padStart(15)
  );

  // Volume-weighted coverage
  const volumeCoverage = totalVolume > 0 ? (okVolume / totalVolume) * 100 : 0;
  console.log('\n' + '─'.repeat(70));
  console.log('COVERAGE METRICS');
  console.log('─'.repeat(70));
  console.log(`  Wallet coverage: ${traderOk.length}/${traderOk.length + traderIncomplete.length} = ${((traderOk.length / (traderOk.length + traderIncomplete.length || 1)) * 100).toFixed(1)}%`);
  console.log(`  Volume coverage: $${okVolume.toLocaleString()}/$${totalVolume.toLocaleString()} = ${volumeCoverage.toFixed(1)}%`);

  // Show worst offenders (largest incomplete wallets by volume)
  if (traderIncomplete.length > 0) {
    console.log('\n' + '─'.repeat(70));
    console.log('LARGEST INCOMPLETE WALLETS (by USDC volume)');
    console.log('─'.repeat(70));
    const sorted = traderIncomplete.sort((a, b) => b.totalUsdcVolume - a.totalUsdcVolume).slice(0, 10);
    console.log('Wallet'.padEnd(15) + ' | ' + 'Volume'.padStart(12) + ' | ' + 'Bad Pos'.padStart(8) + ' | ' + 'Net Diff'.padStart(12));
    console.log('-'.repeat(60));
    for (const r of sorted) {
      console.log(
        r.wallet.slice(0, 12).padEnd(15) +
          ' | ' +
          ('$' + r.totalUsdcVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })).padStart(12) +
          ' | ' +
          String(r.badPositions).padStart(8) +
          ' | ' +
          r.netDifference.toFixed(0).padStart(12)
      );
    }
  }

  // Show some TRADER_OK examples
  if (traderOk.length > 0) {
    console.log('\n' + '─'.repeat(70));
    console.log('SAMPLE TRADER_OK WALLETS (fills complete)');
    console.log('─'.repeat(70));
    const okSorted = traderOk.sort((a, b) => b.totalUsdcVolume - a.totalUsdcVolume).slice(0, 10);
    console.log('Wallet'.padEnd(15) + ' | ' + 'Volume'.padStart(12) + ' | ' + 'Trades'.padStart(8) + ' | ' + 'Positions'.padStart(10));
    console.log('-'.repeat(55));
    for (const r of okSorted) {
      console.log(
        r.wallet.slice(0, 12).padEnd(15) +
          ' | ' +
          ('$' + r.totalUsdcVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })).padStart(12) +
          ' | ' +
          String(r.clobTradeCount).padStart(8) +
          ' | ' +
          String(r.totalPositions).padStart(10)
      );
    }
  }

  // Conclusion
  console.log('\n' + '═'.repeat(70));
  console.log('CONCLUSION');
  console.log('═'.repeat(70));

  const okPct = (traderOk.length / (traderOk.length + traderIncomplete.length || 1)) * 100;
  if (okPct >= 80) {
    console.log(`
✓ GOOD NEWS: ${okPct.toFixed(1)}% of traders have complete fills data.
  Fills-only PnL is viable for the majority of wallets.

  Recommendation:
  1. Use fills-only PnL for wallets that pass the completeness check
  2. Fall back to V17 for incomplete wallets
  3. Display with caveat for incomplete wallets
`);
  } else if (okPct >= 50) {
    console.log(`
⚠ MIXED RESULTS: ${okPct.toFixed(1)}% of traders have complete fills data.
  About half of wallets can use fills-only PnL.

  Recommendation:
  1. Run completeness check before calculating PnL
  2. Use fills-only PnL for complete wallets
  3. Use V17 or show "unavailable" for incomplete wallets
`);
  } else {
    console.log(`
✗ INCOMPLETE DATA: Only ${okPct.toFixed(1)}% of traders have complete fills data.
  Fills-only PnL is NOT viable for most wallets.

  Recommendation:
  1. Continue using V17 (89% pass rate on leaderboard)
  2. Consider backfilling ERC1155 data from block 0
  3. Check if Polymarket exposes a PnL API
`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
