/**
 * Test UI PnL Estimate
 *
 * Tests the UI_PNL_EST function against benchmark wallets.
 */

import { computeUiPnlEstimate, formatUsd } from '../../lib/pnl/computeUiPnlEstimate';

interface BenchmarkWallet {
  addr: string;
  label: string;
  uiPnl: number;
}

const BENCHMARK_WALLETS: BenchmarkWallet[] = [
  {
    addr: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',
    label: 'W2 (Retail)',
    uiPnl: 4405,
  },
  {
    addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    label: 'W_22M (Operator)',
    uiPnl: 22053934,
  },
  {
    addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    label: 'W_97K (Mixed)',
    uiPnl: 96731,
  },
  {
    addr: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    label: 'W_-10M (Operator)',
    uiPnl: -10021172,
  },
];

async function main(): Promise<void> {
  console.log('═'.repeat(100));
  console.log('UI PNL ESTIMATE TEST');
  console.log('═'.repeat(100));
  console.log('');

  const results: Array<{
    label: string;
    uiPnl: number;
    estimate: number;
    difference: number;
    errorPct: number;
    tier: string;
    confidence: string;
  }> = [];

  for (const w of BENCHMARK_WALLETS) {
    console.log(`Processing ${w.label}...`);
    const result = await computeUiPnlEstimate(w.addr);

    const difference = w.uiPnl - result.uiPnlEstimate;
    const errorPct = (difference / Math.abs(w.uiPnl)) * 100;

    results.push({
      label: w.label,
      uiPnl: w.uiPnl,
      estimate: result.uiPnlEstimate,
      difference,
      errorPct,
      tier: result.walletTier,
      confidence: result.confidence,
    });

    console.log(`  Tier: ${result.walletTier} | Short Ratio: ${(result.shortRatio * 100).toFixed(1)}%`);
    console.log(
      `  UI PnL: ${formatUsd(w.uiPnl)} | Estimate: ${formatUsd(result.uiPnlEstimate)} | Diff: ${formatUsd(difference)}`
    );
    console.log('');
  }

  // Summary table
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');
  console.log(
    'Label'.padEnd(20) +
      ' | ' +
      'UI PnL'.padStart(12) +
      ' | ' +
      'Estimate'.padStart(12) +
      ' | ' +
      'Diff'.padStart(12) +
      ' | ' +
      'Error %'.padStart(8) +
      ' | ' +
      'Tier'.padStart(8) +
      ' | ' +
      'Confidence'
  );
  console.log('-'.repeat(100));

  for (const r of results) {
    const errorStr = r.errorPct >= 0 ? `+${r.errorPct.toFixed(1)}%` : `${r.errorPct.toFixed(1)}%`;
    console.log(
      r.label.padEnd(20) +
        ' | ' +
        formatUsd(r.uiPnl).padStart(12) +
        ' | ' +
        formatUsd(r.estimate).padStart(12) +
        ' | ' +
        formatUsd(r.difference).padStart(12) +
        ' | ' +
        errorStr.padStart(8) +
        ' | ' +
        r.tier.padStart(8) +
        ' | ' +
        r.confidence
    );
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('NOTES:');
  console.log('- High confidence: Retail wallets with low short exposure (<10%)');
  console.log('- Medium confidence: Mixed wallets with moderate short exposure (10-30%)');
  console.log('- Low confidence: Operator/MM wallets with high short exposure (>30%)');
  console.log('');
  console.log('The exact Polymarket UI formula is not fully documented.');
  console.log('For high-confidence wallets, our estimate should be within ±5%.');
  console.log('═'.repeat(100));
}

main().catch(console.error);
