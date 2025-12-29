#!/usr/bin/env npx tsx
/**
 * Dome Hybrid vs Dome API Deep Trace
 *
 * Runs a 10-wallet comparison between Dome Hybrid calculation and Dome API.
 * Prints detailed breakdown for debugging.
 */

import { deepTrace, closeClient } from '../../lib/pnl/realizedPnlDomeHybridV1';
import { fetchDomeRealizedPnL } from '../../lib/pnl/domeClient';

async function runDeepTrace() {
  // Use wallets from the Dome validation that showed discrepancies
  const wallets = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    '0xc5d563a36ae78145c45a50134d48a1215220f80a',
    '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2',
    '0xb744f56635b537e859152d14b022af5afe485210',
    '0x42592084120b0d5287059919d2a96b3b7acb936f',
    '0x5c8b9b70bc69dfc0a8e38f0f3b8e4b4c5c9c8e4a',
    '0xb91115b2ba8f1d4c18d7fde28ebfad5d118bb445',
    '0x26437896ed9dfeb2f69765edcafe5e46b63952e5',
    '0x76062e7bbfc0fb783487ff8849605e4e15a60dfe',
    '0x900c83447eb74c3f29f17658e8484e0f3c9f5cfe',
  ];

  console.log('='.repeat(80));
  console.log('DOME HYBRID VS DOME API DEEP TRACE (10 Wallets)');
  console.log('='.repeat(80));
  console.log('');
  console.log('Formula: dome_hybrid = clob_cash_v9 + redemption_cash_v8');
  console.log('');

  let passCount = 0;
  let coverageCount = 0;

  for (const wallet of wallets) {
    console.log('-'.repeat(80));
    console.log('Wallet:', wallet);

    // Fetch Dome API value
    const domeResult = await fetchDomeRealizedPnL(wallet);
    const hasCoverage = domeResult.confidence !== 'none' && !domeResult.isPlaceholder;
    const domeValue = hasCoverage ? domeResult.realizedPnl : null;

    // Run deep trace
    const trace = await deepTrace(wallet, domeValue);

    console.log('');
    console.log('  DOME HYBRID CALCULATION:');
    console.log('    CLOB cash (V9):      $' + trace.hybrid.breakdown.clobCashV9.toFixed(2));
    console.log('    Redemption cash (V8): $' + trace.hybrid.breakdown.redemptionCashV8.toFixed(2));
    console.log('    TOTAL:               $' + trace.hybrid.realizedPnl.toFixed(2));
    console.log('');
    console.log('  EVENT COUNTS:');
    console.log('    CLOB events (V9):     ' + trace.hybrid.eventCounts.clobEventsV9);
    console.log('    Redemption events:    ' + trace.hybrid.eventCounts.redemptionEventsV8);
    console.log('');
    console.log('  DOME API:');
    console.log('    Realized PnL:        $' + (trace.domeApi.realizedPnl?.toFixed(2) || 'N/A'));
    console.log('    Has coverage:        ' + trace.domeApi.hasCoverage);
    console.log('');

    if (trace.domeApi.hasCoverage) {
      coverageCount++;
      console.log('  COMPARISON:');
      console.log('    Delta:               $' + trace.comparison.delta?.toFixed(2));
      console.log('    Delta %:             ' + ((trace.comparison.deltaPct || 0) * 100).toFixed(2) + '%');
      console.log('    Within 10%:          ' + (trace.comparison.withinTolerance ? '✅ YES' : '❌ NO'));

      if (trace.comparison.withinTolerance) passCount++;
    }

    console.log('');
    console.log('  CONTRIBUTION ANALYSIS:');
    console.log('    CLOB contribution:    ' + (trace.componentAnalysis.clobContribution * 100).toFixed(1) + '%');
    console.log('    Redemption contrib:   ' + (trace.componentAnalysis.redemptionContribution * 100).toFixed(1) + '%');
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('Total wallets:      ' + wallets.length);
  console.log('With Dome coverage: ' + coverageCount);
  console.log(
    'Within 10% tol:     ' +
      passCount +
      ' (' +
      (coverageCount > 0 ? ((passCount / coverageCount) * 100).toFixed(1) : 0) +
      '%)'
  );

  await closeClient();
}

runDeepTrace().catch(console.error);
