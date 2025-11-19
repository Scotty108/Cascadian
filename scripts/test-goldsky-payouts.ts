/**
 * Test Goldsky Payout Client
 *
 * Quick validation script to test the Goldsky API client
 * before running the full 170k backfill
 *
 * USAGE:
 *   npx tsx test-goldsky-payouts.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import * as fs from 'fs';
import { fetchPayoutsBatch, fetchPayoutsConcurrent } from '@/lib/polymarket/goldsky-payouts';

async function testSingleBatch() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: Single Batch (5 IDs)');
  console.log('='.repeat(80) + '\n');

  // Read first 5 IDs from file
  const content = fs.readFileSync(
    resolve(process.cwd(), 'reports/condition_ids_missing_api.txt'),
    'utf8'
  );
  const ids = content.trim().split('\n').slice(0, 5);

  console.log('Testing with IDs:');
  ids.forEach((id, i) => console.log(`  ${i + 1}. ${id}`));

  console.log('\n🔄 Fetching payouts...\n');

  try {
    const payouts = await fetchPayoutsBatch(ids);

    console.log(`✅ Success! Found ${payouts.length} payouts (out of ${ids.length} IDs)\n`);

    if (payouts.length > 0) {
      console.log('Sample payout:');
      console.log(JSON.stringify(payouts[0], null, 2));
    } else {
      console.log('⚠️  No payouts found (markets may not be resolved yet)');
    }

    return true;
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function testLargeBatch() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: Large Batch (1,000 IDs)');
  console.log('='.repeat(80) + '\n');

  const content = fs.readFileSync(
    resolve(process.cwd(), 'reports/condition_ids_missing_api.txt'),
    'utf8'
  );
  const ids = content.trim().split('\n').slice(0, 1000);

  console.log(`Testing with ${ids.length} IDs...\n`);

  try {
    const startTime = Date.now();
    const payouts = await fetchPayoutsBatch(ids);
    const duration = Date.now() - startTime;

    console.log(`✅ Success!`);
    console.log(`   IDs queried: ${ids.length}`);
    console.log(`   Payouts found: ${payouts.length} (${((payouts.length / ids.length) * 100).toFixed(1)}%)`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Rate: ${(ids.length / (duration / 1000)).toFixed(0)} IDs/sec\n`);

    if (payouts.length > 0) {
      // Analyze payout formats
      const denominators = new Map<number, number>();
      const winningIndices = new Map<number, number>();

      payouts.forEach(p => {
        denominators.set(p.payout_denominator, (denominators.get(p.payout_denominator) || 0) + 1);
        winningIndices.set(p.winning_index, (winningIndices.get(p.winning_index) || 0) + 1);
      });

      console.log('Payout formats:');
      console.log('  Denominators:', Array.from(denominators.entries()).map(([d, c]) => `${d} (${c}x)`).join(', '));
      console.log('  Winning indices:', Array.from(winningIndices.entries()).map(([i, c]) => `${i} (${c}x)`).join(', '));
    }

    return true;
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function testConcurrent() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Concurrent Batches (5,000 IDs, 5 batches)');
  console.log('='.repeat(80) + '\n');

  const content = fs.readFileSync(
    resolve(process.cwd(), 'reports/condition_ids_missing_api.txt'),
    'utf8'
  );
  const ids = content.trim().split('\n').slice(0, 5000);

  console.log(`Testing with ${ids.length} IDs (5 concurrent batches of 1,000)...\n`);

  try {
    const startTime = Date.now();
    const payouts = await fetchPayoutsConcurrent(ids, 1000, 5);
    const duration = Date.now() - startTime;

    console.log(`✅ Success!`);
    console.log(`   IDs queried: ${ids.length}`);
    console.log(`   Payouts found: ${payouts.length} (${((payouts.length / ids.length) * 100).toFixed(1)}%)`);
    console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(1)}s)`);
    console.log(`   Rate: ${(ids.length / (duration / 1000)).toFixed(0)} IDs/sec`);
    console.log(`   Throughput: ${((ids.length / (duration / 1000)) * 60).toFixed(0)} IDs/min\n`);

    // Estimate full backfill time
    const totalIds = 170448;
    const estimatedSeconds = (totalIds / ids.length) * (duration / 1000);
    const estimatedMinutes = estimatedSeconds / 60;
    const estimatedWith4Workers = estimatedMinutes / 4;

    console.log('📊 Backfill Estimate:');
    console.log(`   Total IDs: ${totalIds.toLocaleString()}`);
    console.log(`   Single worker: ${estimatedMinutes.toFixed(0)} minutes (${(estimatedMinutes / 60).toFixed(1)} hours)`);
    console.log(`   4 workers: ${estimatedWith4Workers.toFixed(0)} minutes (${(estimatedWith4Workers / 60).toFixed(1)} hours)`);

    return true;
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function testPayoutFormats() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 4: Payout Format Validation');
  console.log('='.repeat(80) + '\n');

  // Test with known resolved markets
  const testIds = [
    '0000074ba83ff8fb5b39ebbe2d366bcf1a537b31bdd53afb21ef2019d8b7d32e',
    '00004a51362c3e68e2c1f84b51c6e2dd18263554cc64f07272a7b5ee4448f2bb',
    '00008f10a3e2abc0bf7f033edcfb5f170e6f95de9ad3f060ec82e7f413275ba6',
  ];

  console.log('Testing payout parsing with 3 sample IDs...\n');

  try {
    const payouts = await fetchPayoutsBatch(testIds);

    console.log(`Found ${payouts.length} payouts:\n`);

    payouts.forEach((p, i) => {
      console.log(`Payout ${i + 1}:`);
      console.log(`  Condition ID: ${p.condition_id}`);
      console.log(`  Numerators: [${p.payout_numerators.join(', ')}]`);
      console.log(`  Denominator: ${p.payout_denominator}`);
      console.log(`  Winning index: ${p.winning_index}`);
      console.log(`  Sum check: ${p.payout_numerators.reduce((a, b) => a + b, 0)} / ${p.payout_denominator}`);
      console.log(`  Source: ${p.source}`);
      console.log('');

      // Validate payout
      const sum = p.payout_numerators.reduce((a, b) => a + b, 0);
      if (sum !== p.payout_denominator) {
        console.warn(`  ⚠️  WARNING: Sum mismatch! ${sum} !== ${p.payout_denominator}`);
      }

      if (p.winning_index < 0 || p.winning_index >= p.payout_numerators.length) {
        console.warn(`  ⚠️  WARNING: Invalid winning_index ${p.winning_index}`);
      }
    });

    return payouts.length > 0;
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function main() {
  console.log('\n🧪 GOLDSKY PAYOUT CLIENT TESTS\n');

  const results = {
    test1: false,
    test2: false,
    test3: false,
    test4: false,
  };

  results.test1 = await testSingleBatch();
  results.test2 = await testLargeBatch();
  results.test3 = await testConcurrent();
  results.test4 = await testPayoutFormats();

  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80) + '\n');

  console.log(`Test 1 (Single Batch):     ${results.test1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (Large Batch):      ${results.test2 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 3 (Concurrent):       ${results.test3 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 4 (Format Validation):${results.test4 ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = Object.values(results).every(r => r);

  if (allPassed) {
    console.log('\n✅ All tests passed! Ready to run full backfill.\n');
    console.log('Next steps:');
    console.log('  1. Review BACKFILL_PAYOUTS_GUIDE.md');
    console.log('  2. Run: npx tsx backfill-payouts-parallel.ts --worker=1 --of=4');
    console.log('  3. Open 3 more terminals and run workers 2, 3, 4\n');
  } else {
    console.log('\n❌ Some tests failed. Please investigate before running full backfill.\n');
    process.exit(1);
  }
}

main().catch(console.error);
