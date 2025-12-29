/**
 * Sweep Transfer Cost Models
 *
 * Tests all combinations of:
 * - includeErc1155Transfers: true/false
 * - transferCostModel: 'zero_cost' | 'neutral_point5'
 *
 * Goal: Find the model that minimizes error vs Polymarket UI while
 * keeping W2 (our "ground truth" wallet) unchanged.
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  computeWalletPnlFromEvents,
  TransferCostModel,
  EngineOptions,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

interface ModelResult {
  label: string;
  wallet: string;
  uiPnl: number;
  model: string;
  includeXfers: boolean;
  enginePnl: number;
  diff: number;
  errorPct: number;
  transferIn: number;
  transferOut: number;
}

const MODELS: { name: string; model: TransferCostModel }[] = [
  { name: 'zero_cost', model: 'zero_cost' },
  { name: 'neutral_0.5', model: 'neutral_point5' },
];

async function main(): Promise<void> {
  console.log('═'.repeat(120));
  console.log('TRANSFER COST MODEL SWEEP - Finding Best UI Parity Configuration');
  console.log('═'.repeat(120));
  console.log('');

  const allResults: ModelResult[] = [];

  for (const bm of UI_BENCHMARK_WALLETS) {
    console.log(`Processing ${bm.label} (${bm.wallet.substring(0, 12)}...)...`);

    // Load events once without transfers, once with
    const eventsNoXfers = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: true,
      includeErc1155Transfers: false,
    });

    const eventsWithXfers = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: true,
      includeErc1155Transfers: true,
    });

    const transferIn = eventsWithXfers.filter((e) => e.eventType === 'TRANSFER_IN').length;
    const transferOut = eventsWithXfers.filter((e) => e.eventType === 'TRANSFER_OUT').length;

    // Test: No transfers (baseline)
    const resultNoXfers = computeWalletPnlFromEvents(bm.wallet, eventsNoXfers, {});
    allResults.push({
      label: bm.label,
      wallet: bm.wallet,
      uiPnl: bm.profitLoss_all,
      model: 'no_transfers',
      includeXfers: false,
      enginePnl: resultNoXfers.realizedPnl,
      diff: resultNoXfers.realizedPnl - bm.profitLoss_all,
      errorPct: Math.abs((resultNoXfers.realizedPnl - bm.profitLoss_all) / bm.profitLoss_all) * 100,
      transferIn: 0,
      transferOut: 0,
    });

    // Test: With transfers, each cost model
    for (const m of MODELS) {
      const options: EngineOptions = { transferCostModel: m.model };
      const result = computeWalletPnlFromEvents(bm.wallet, eventsWithXfers, options);

      allResults.push({
        label: bm.label,
        wallet: bm.wallet,
        uiPnl: bm.profitLoss_all,
        model: m.name,
        includeXfers: true,
        enginePnl: result.realizedPnl,
        diff: result.realizedPnl - bm.profitLoss_all,
        errorPct: Math.abs((result.realizedPnl - bm.profitLoss_all) / bm.profitLoss_all) * 100,
        transferIn,
        transferOut,
      });
    }
  }

  // Print per-wallet results
  for (const bm of UI_BENCHMARK_WALLETS) {
    const walletResults = allResults.filter((r) => r.label === bm.label);

    console.log('');
    console.log('─'.repeat(120));
    console.log(`${bm.label} (UI PnL: $${bm.profitLoss_all.toFixed(2)})`);
    console.log('─'.repeat(120));
    console.log('| Model           | Xfers | Engine PnL   | Diff vs UI   | Error %  | IN/OUT |');
    console.log('|-----------------|-------|--------------|--------------|----------|--------|');

    for (const r of walletResults) {
      const xfersStr = r.includeXfers ? 'yes' : 'no';
      const engineStr = `$${r.enginePnl.toFixed(2)}`.padStart(11);
      const diffStr = `${r.diff >= 0 ? '+' : ''}$${r.diff.toFixed(2)}`.padStart(11);
      const errorStr = `${r.errorPct.toFixed(1)}%`.padStart(7);
      const ioStr = r.includeXfers ? `${r.transferIn}/${r.transferOut}`.padStart(6) : '  -   ';

      // Highlight best match
      const marker = Math.abs(r.diff) < 1 ? ' ✅' : Math.abs(r.diff) < 100 ? ' ⚡' : '';

      console.log(
        `| ${r.model.padEnd(15)} | ${xfersStr.padEnd(5)} | ${engineStr} | ${diffStr} | ${errorStr} | ${ioStr} |${marker}`
      );
    }
  }

  // Summary table: Compare models across all wallets
  console.log('');
  console.log('═'.repeat(120));
  console.log('SUMMARY: Total Absolute Error by Model');
  console.log('═'.repeat(120));

  const modelNames = ['no_transfers', ...MODELS.map((m) => m.name)];

  for (const modelName of modelNames) {
    const modelResults = allResults.filter((r) => r.model === modelName);
    const totalAbsError = modelResults.reduce((sum, r) => sum + Math.abs(r.diff), 0);
    const w2Result = modelResults.find((r) => r.label === 'W2');
    const w2Diff = w2Result?.diff ?? 0;

    console.log(
      `${modelName.padEnd(20)} | Total Abs Error: $${totalAbsError.toFixed(2).padStart(10)} | W2 Diff: ${w2Diff >= 0 ? '+' : ''}$${w2Diff.toFixed(2)}`
    );
  }

  // Find best model (minimize total error while keeping W2 close)
  console.log('');
  console.log('─'.repeat(120));
  console.log('RECOMMENDATION:');
  console.log('─'.repeat(120));

  let bestModel = 'no_transfers';
  let bestError = Infinity;

  for (const modelName of modelNames) {
    const modelResults = allResults.filter((r) => r.model === modelName);
    const w2Result = modelResults.find((r) => r.label === 'W2');

    // Skip if W2 error exceeds $10 (must preserve our ground truth)
    if (w2Result && Math.abs(w2Result.diff) > 10) {
      continue;
    }

    const totalAbsError = modelResults.reduce((sum, r) => sum + Math.abs(r.diff), 0);
    if (totalAbsError < bestError) {
      bestError = totalAbsError;
      bestModel = modelName;
    }
  }

  console.log(`Best model: ${bestModel}`);
  console.log(`Total absolute error: $${bestError.toFixed(2)}`);
  console.log('');

  // Show the best model's per-wallet breakdown
  const bestResults = allResults.filter((r) => r.model === bestModel);
  console.log('Per-wallet breakdown with best model:');
  console.log('| Wallet | UI PnL      | Engine PnL  | Diff        | Error % |');
  console.log('|--------|-------------|-------------|-------------|---------|');

  for (const r of bestResults) {
    const uiStr = `$${r.uiPnl.toFixed(2)}`.padStart(10);
    const engineStr = `$${r.enginePnl.toFixed(2)}`.padStart(10);
    const diffStr = `${r.diff >= 0 ? '+' : ''}$${r.diff.toFixed(2)}`.padStart(10);
    const errorStr = `${r.errorPct.toFixed(1)}%`.padStart(6);

    console.log(`| ${r.label.padEnd(6)} | ${uiStr} | ${engineStr} | ${diffStr} | ${errorStr} |`);
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
