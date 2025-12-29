#!/usr/bin/env tsx

/**
 * sample-clob-only-validation-set.ts
 *
 * Samples CLOB-only wallets from pm_unified_ledger_v8_tbl for large-scale validation.
 * Generates stratified random samples at multiple sizes: 100, 250, 500, 1000 wallets.
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

interface WalletCandidate {
  wallet: string;
  clob_events: number;
  redemption_events: number;
  split_events: number;
  merge_events: number;
  condition_count: number;
  cash_flow: number;
}

async function sampleCLOBOnlyWallets() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  CLOB-ONLY WALLET SAMPLER');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Step 1: Get wallet candidates from pm_trader_events_v2 (faster than full ledger scan)
  console.log('Step 1: Querying pm_trader_events_v2 for candidate wallets...');

  const walletQuery = `
    SELECT DISTINCT trader_wallet as wallet
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    LIMIT 10000
  `;

  const walletResult = await clickhouse.query({
    query: walletQuery,
    format: 'JSONEachRow',
  });

  const walletList: { wallet: string }[] = await walletResult.json() as any;
  console.log(`  Found ${walletList.length} candidate wallets\n`);

  // Step 2: Batch query to classify wallets
  console.log('Step 2: Classifying wallets by event types (batches of 100)...');

  const candidates: WalletCandidate[] = [];
  const batchSize = 100;

  for (let i = 0; i < Math.min(walletList.length, 2000); i += batchSize) {
    const batch = walletList.slice(i, i + batchSize);
    const wallets = batch.map(w => `'${w.wallet}'`).join(',');

    const query = `
      SELECT
        wallet_address as wallet,
        countIf(source_type = 'CLOB') as clob_events,
        countIf(source_type = 'PayoutRedemption') as redemption_events,
        countIf(source_type = 'PositionSplit') as split_events,
        countIf(source_type = 'PositionsMerge') as merge_events,
        count(DISTINCT condition_id) as condition_count,
        sum(usdc_delta) as cash_flow
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address IN (${wallets})
      GROUP BY wallet_address
      HAVING
        split_events = 0 AND merge_events = 0  -- CLOB-only filter
        AND clob_events >= 20
        AND clob_events <= 1000
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    });

    const batchCandidates: WalletCandidate[] = await result.json() as any;
    candidates.push(...batchCandidates);

    process.stdout.write(`\r  Processed ${Math.min(i + batchSize, walletList.length)}/${Math.min(walletList.length, 2000)} wallets, found ${candidates.length} CLOB-only candidates`);

    // Stop if we have enough candidates
    if (candidates.length >= 1500) break;
  }

  console.log('\n');

  console.log(`Found ${candidates.length} CLOB-only wallet candidates`);

  if (candidates.length === 0) {
    console.log('\n⚠️  No CLOB-only candidates found. Exiting.');
    await clickhouse.close();
    return;
  }

  console.log(`  CLOB events range: ${Math.min(...candidates.map(c => c.clob_events))} - ${Math.max(...candidates.map(c => c.clob_events))}`);
  console.log(`  Condition count range: ${Math.min(...candidates.map(c => c.condition_count))} - ${Math.max(...candidates.map(c => c.condition_count))}`);

  // Step 3: Generate samples at different sizes
  const sampleSizes = [100, 250, 500, 1000];
  const tmpDir = path.join(process.cwd(), 'tmp');

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  console.log('\nStep 3: Generating random samples...\n');

  for (const size of sampleSizes) {
    if (size > candidates.length) {
      console.log(`⚠️  Requested sample size ${size} exceeds available candidates (${candidates.length}), skipping`);
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
        filter_criteria: 'split_events = 0 AND merge_events = 0 AND clob_events >= 20 AND clob_events <= 1000',
      },
      wallets: sample,
    }, null, 2));

    // Print statistics
    const avgCLOB = sample.reduce((sum, w) => sum + w.clob_events, 0) / size;
    const avgConditions = sample.reduce((sum, w) => sum + w.condition_count, 0) / size;
    const totalCashFlow = sample.reduce((sum, w) => sum + w.cash_flow, 0);

    console.log(`✓ Sample N=${size} → ${outputPath}`);
    console.log(`  Average CLOB events: ${avgCLOB.toFixed(1)}`);
    console.log(`  Average conditions: ${avgConditions.toFixed(1)}`);
    console.log(`  Total cash flow: $${totalCashFlow.toFixed(2)}`);
    console.log(`  Positive cash flow: ${sample.filter(w => w.cash_flow > 0).length} wallets`);
    console.log(`  Negative cash flow: ${sample.filter(w => w.cash_flow < 0).length} wallets\n`);
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SAMPLING COMPLETE');
  console.log('══════════════════════════════════════════════════════════════');

  await clickhouse.close();
}

sampleCLOBOnlyWallets().catch(console.error);
