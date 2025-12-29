#!/usr/bin/env npx tsx

/**
 * sample-clob-only-validation-set-v2.ts
 *
 * Simpler approach: Read existing CLOB-only wallet list and generate
 * stratified random samples at multiple sizes.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ExistingWallet {
  wallet: string;
  clobTrades: number;
  ctfSplits: number;
  ctfMerges: number;
  ctfRedemptions: number;
}

interface WalletCandidate {
  wallet: string;
  clob_events: number;
  redemption_events: number;
  split_events: number;
  merge_events: number;
  condition_count: number;
  cash_flow: number;
}

async function generateSamples() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  CLOB-ONLY WALLET SAMPLER (V2 - FROM EXISTING DATA)');
  console.log('══════════════════════════════════════════════════════════════\n');

  const tmpDir = path.join(process.cwd(), 'tmp');
  const inputPath = path.join(tmpDir, 'clob_only_validation_set.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error('Please ensure clob_only_validation_set.json exists in tmp/');
    process.exit(1);
  }

  // Load existing wallets
  const inputData: { wallets: ExistingWallet[] } = JSON.parse(
    fs.readFileSync(inputPath, 'utf-8')
  );

  console.log(`Loaded ${inputData.wallets.length} CLOB-only wallets from existing data`);

  // Filter for truly CLOB-only (0 splits, 0 merges)
  const clobOnly = inputData.wallets.filter(
    w => w.ctfSplits === 0 && w.ctfMerges === 0
  );

  console.log(`  Filtered to ${clobOnly.length} pure CLOB-only wallets\n`);

  // Convert to expected format
  const candidates: WalletCandidate[] = clobOnly.map(w => ({
    wallet: w.wallet,
    clob_events: w.clobTrades,
    redemption_events: w.ctfRedemptions,
    split_events: 0,
    merge_events: 0,
    condition_count: 0, // Unknown from this data
    cash_flow: 0, // Will be calculated during validation
  }));

  // Generate samples
  const sampleSizes = [100, 150]; // 150 is all we have

  console.log('Generating random samples...\n');

  for (const size of sampleSizes) {
    if (size > candidates.length) {
      console.log(`⚠️  Requested sample size ${size} exceeds available candidates (${candidates.length}), using all ${candidates.length}`);
      const actualSize = candidates.length;

      const outputPath = path.join(tmpDir, `clob_only_validation_sample_${actualSize}.json`);
      fs.writeFileSync(outputPath, JSON.stringify({
        metadata: {
          sample_size: actualSize,
          generated_at: new Date().toISOString(),
          total_candidates: candidates.length,
          filter_criteria: 'split_events = 0 AND merge_events = 0 (pure CLOB-only)',
          source: 'tmp/clob_only_validation_set.json',
        },
        wallets: candidates,
      }, null, 2));

      console.log(`✓ Sample N=${actualSize} → ${outputPath}`);
      continue;
    }

    // Random sample without replacement
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, size);

    const outputPath = path.join(tmpDir, `clob_only_validation_sample_${size}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({
      metadata: {
        sample_size: size,
        generated_at: new Date().toISOString(),
        total_candidates: candidates.length,
        filter_criteria: 'split_events = 0 AND merge_events = 0 (pure CLOB-only)',
        source: 'tmp/clob_only_validation_set.json',
      },
      wallets: sample,
    }, null, 2));

    const avgCLOB = sample.reduce((sum, w) => sum + w.clob_events, 0) / size;
    const avgRedemptions = sample.reduce((sum, w) => sum + w.redemption_events, 0) / size;

    console.log(`✓ Sample N=${size} → ${outputPath}`);
    console.log(`  Average CLOB events: ${avgCLOB.toFixed(1)}`);
    console.log(`  Average redemptions: ${avgRedemptions.toFixed(1)}\n`);
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SAMPLING COMPLETE');
  console.log('══════════════════════════════════════════════════════════════');
}

generateSamples().catch(console.error);
