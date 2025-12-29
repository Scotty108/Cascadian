#!/usr/bin/env npx tsx
/**
 * Compare V11 vs V29 PnL Engines
 *
 * V11: Single total PnL (includes auto-resolution)
 * V29: Separated metrics:
 *   - realizedPnl (CLOB + redemptions only)
 *   - resolvedUnredeemedValue (synthetic resolution)
 *   - uiParityPnl (total)
 *
 * This demonstrates the V12 Architecture Spec implementation.
 */

import { V11Engine, createV11Engine } from '../../lib/pnl/uiActivityEngineV11';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import { isTraderStrict, getActivityCounts } from '../../lib/pnl/walletClassifier';

interface ComparisonResult {
  wallet: string;
  badge: string;
  ctfCounts: { splits: number; merges: number; redemptions: number };
  v11: {
    realized_pnl: number;
    total_gain: number;
    total_loss: number;
  };
  v29: {
    realizedPnl: number;
    resolvedUnredeemedValue: number;
    uiParityPnl: number;
    unrealizedPnl: number;
  };
  comparison: {
    v11_vs_v29_realized_diff: number;
    v11_vs_v29_total_diff: number;
    synthetic_contribution: number;
    synthetic_pct: number;
  };
}

async function compareWallet(wallet: string): Promise<ComparisonResult> {
  // Get wallet classification
  const strictCheck = await isTraderStrict(wallet);
  const activity = await getActivityCounts(wallet);

  // Determine badge
  let badge = 'UNKNOWN';
  if (activity.split_events === 0 && activity.merge_events === 0 && activity.redemption_events === 0) {
    badge = 'CLOB_ONLY';
  } else if (activity.split_events > 0 || activity.merge_events > 10) {
    badge = 'SPLIT_MERGE';
  } else if (activity.redemption_events > 10) {
    badge = 'REDEMPTION_HEAVY';
  } else {
    badge = 'MIXED';
  }

  // Calculate V11
  const v11Engine = createV11Engine();
  const v11Result = await v11Engine.compute(wallet);

  // Calculate V29
  const v29Result = await calculateV29PnL(wallet, { inventoryGuard: true });

  // Compare
  const v11_total = v11Result.realized_pnl;
  const v29_total = v29Result.uiParityPnl;
  const v29_realized_only = v29Result.realizedPnl;
  const synthetic = v29Result.resolvedUnredeemedValue;

  return {
    wallet: wallet.slice(0, 12) + '...',
    badge,
    ctfCounts: {
      splits: activity.split_events,
      merges: activity.merge_events,
      redemptions: activity.redemption_events,
    },
    v11: {
      realized_pnl: v11Result.realized_pnl,
      total_gain: v11Result.total_gain,
      total_loss: v11Result.total_loss,
    },
    v29: {
      realizedPnl: v29Result.realizedPnl,
      resolvedUnredeemedValue: v29Result.resolvedUnredeemedValue,
      uiParityPnl: v29Result.uiParityPnl,
      unrealizedPnl: v29Result.unrealizedPnl,
    },
    comparison: {
      v11_vs_v29_realized_diff: v11_total - v29_realized_only,
      v11_vs_v29_total_diff: v11_total - v29_total,
      synthetic_contribution: synthetic,
      synthetic_pct: v29_total !== 0 ? (synthetic / Math.abs(v29_total)) * 100 : 0,
    },
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('V11 vs V29 ENGINE COMPARISON');
  console.log('='.repeat(100));
  console.log();
  console.log('V12 Architecture Spec Implementation:');
  console.log('  V11: Single total PnL (includes auto-resolution - causes overcount)');
  console.log('  V29: Separated metrics:');
  console.log('    - realizedPnl: Only from CLOB sells + PayoutRedemption events');
  console.log('    - resolvedUnredeemedValue: Synthetic resolution (mark-to-payout)');
  console.log('    - uiParityPnl: Total (realizedPnl + resolvedUnredeemedValue)');
  console.log();

  // Test wallets from the validation
  const testWallets = [
    { wallet: '0x8c573be6f79a6207b895eb726c3cf408db50cf0e', name: '@kinfolk (CLOB-only)' },
    { wallet: '0x1ff49fdcb6685c94059b65620f43a683be0ce7a5', name: 'Heavy redemption' },
    { wallet: '0x30cecdf29fb548d6f895cd41e3dfdf80d0bc4698', name: '@ZXWP' },
  ];

  const results: ComparisonResult[] = [];

  for (const { wallet, name } of testWallets) {
    console.log(`Processing ${name}...`);
    try {
      const result = await compareWallet(wallet);
      results.push(result);
      console.log(`  Done: badge=${result.badge}`);
    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }
  }

  console.log();
  console.log('='.repeat(100));
  console.log('RESULTS');
  console.log('='.repeat(100));
  console.log();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = testWallets[i].name;

    console.log(`[${name}] ${r.wallet}`);
    console.log(`  Badge: ${r.badge}`);
    console.log(`  CTF Events: splits=${r.ctfCounts.splits}, merges=${r.ctfCounts.merges}, redemptions=${r.ctfCounts.redemptions}`);
    console.log();
    console.log('  V11 (single total):');
    console.log(`    realized_pnl: $${r.v11.realized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log();
    console.log('  V29 (separated metrics):');
    console.log(`    realizedPnl (CLOB+redemption): $${r.v29.realizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    resolvedUnredeemedValue:       $${r.v29.resolvedUnredeemedValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    uiParityPnl (total):           $${r.v29.uiParityPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    unrealizedPnl:                 $${r.v29.unrealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log();
    console.log('  Comparison:');
    console.log(`    V11 - V29 realized_only: $${r.comparison.v11_vs_v29_realized_diff.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    V11 - V29 total:         $${r.comparison.v11_vs_v29_total_diff.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    Synthetic contribution:  $${r.comparison.synthetic_contribution.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${r.comparison.synthetic_pct.toFixed(1)}%)`);
    console.log();
    console.log('-'.repeat(100));
    console.log();
  }

  console.log('SUMMARY:');
  console.log();
  console.log('V29 provides metric separation as specified in V12 Architecture Spec:');
  console.log('  - realizedPnl: Actual cash events (CLOB sells, PayoutRedemption)');
  console.log('  - resolvedUnredeemedValue: Synthetic resolution (mark-to-payout for resolved markets)');
  console.log('  - uiParityPnl: Total that should match UI');
  console.log();
  console.log('For CLOB-only wallets, use realizedPnl as the primary metric.');
  console.log('For mixed wallets, use uiParityPnl but show resolvedUnredeemedValue separately.');
}

main().catch(console.error);
