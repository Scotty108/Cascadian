/**
 * Continuous Wallet Processing Pipeline
 *
 * Processes the queue of discovered wallets by:
 * 1. Fetching wallets that need data updates
 * 2. Processing them in parallel batches
 * 3. Handling errors with retry logic
 * 4. Continuing until queue is empty
 *
 * Run this continuously to keep all wallet data fresh.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { processWallet } from './ingest-wallet-data';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ProcessingStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  startTime: Date;
  lastBatchTime?: Date;
}

const stats: ProcessingStats = {
  totalProcessed: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  startTime: new Date(),
};

// Configuration
const BATCH_SIZE = 10; // Process 10 wallets at a time
const CONCURRENCY = 5; // 5 concurrent API calls
const RETRY_DELAY = 60 * 1000; // 1 minute between retries
const UPDATE_THRESHOLD = 6 * 60 * 60 * 1000; // Update if older than 6 hours

/**
 * Fetch wallets that need processing
 */
async function fetchWalletsToProcess(limit: number): Promise<string[]> {
  const sixHoursAgo = new Date(Date.now() - UPDATE_THRESHOLD).toISOString();

  // Prioritize:
  // 1. Never fetched (whale_score = 0 AND total_trades = 0)
  // 2. Not updated recently (last_seen_at < 6 hours ago)
  // 3. Whales (higher priority for active whales)

  const { data, error } = await supabase
    .from('wallets')
    .select('wallet_address, whale_score, last_seen_at')
    .or(`total_trades.eq.0,last_seen_at.lt.${sixHoursAgo}`)
    .order('whale_score', { ascending: false }) // Whales first
    .order('last_seen_at', { ascending: true, nullsFirst: true }) // Oldest first
    .limit(limit);

  if (error) {
    console.error('Error fetching wallets to process:', error);
    return [];
  }

  return data?.map(w => w.wallet_address) || [];
}

/**
 * Process a batch of wallets with concurrency control
 */
async function processBatch(wallets: string[]): Promise<void> {
  console.log(`\n📦 Processing batch of ${wallets.length} wallets...`);
  stats.lastBatchTime = new Date();

  const results: Array<{
    address: string;
    success: boolean;
    error?: any;
  }> = [];

  // Process with concurrency limit
  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);

    const promises = batch.map(async (address) => {
      try {
        const result = await processWallet(address);
        stats.totalProcessed++;

        if (result.success) {
          stats.successful++;
          return { address, success: true };
        } else {
          stats.failed++;
          return { address, success: false, error: result.error };
        }
      } catch (error) {
        stats.failed++;
        return { address, success: false, error };
      }
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);

    // Progress indicator
    const processed = Math.min(i + CONCURRENCY, wallets.length);
    process.stdout.write(`\r  Progress: ${processed}/${wallets.length} (${stats.successful} successful, ${stats.failed} failed)`);

    // Rate limiting between concurrent batches
    if (i + CONCURRENCY < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n');

  // Log failures for retry
  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    console.log(`\n⚠️  ${failures.length} wallets failed in this batch`);
    failures.forEach(f => {
      console.log(`  - ${f.address}: ${f.error?.message || 'Unknown error'}`);
    });
  }
}

/**
 * Main processing loop
 */
async function processQueue(): Promise<void> {
  console.log('\n🚀 CONTINUOUS WALLET PROCESSING');
  console.log('='.repeat(60));
  console.log('Mission: Process ALL wallets in the queue\n');

  let hasMore = true;
  let iteration = 0;

  while (hasMore) {
    iteration++;

    console.log(`\n📊 Iteration ${iteration}`);
    console.log(`  Fetching next batch of ${BATCH_SIZE} wallets...`);

    // Fetch wallets that need processing
    const wallets = await fetchWalletsToProcess(BATCH_SIZE);

    if (wallets.length === 0) {
      console.log('\n✅ Queue is empty! All wallets are up to date.');
      hasMore = false;
      break;
    }

    console.log(`  Found ${wallets.length} wallets to process`);

    // Process this batch
    await processBatch(wallets);

    // Print stats
    printProgress();

    // Small delay between iterations
    if (wallets.length === BATCH_SIZE) {
      console.log('\n⏸️  Pausing 5s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Final summary
  printSummary();
}

/**
 * Print progress stats
 */
function printProgress(): void {
  const duration = (Date.now() - stats.startTime.getTime()) / 1000;
  const rate = duration > 0 ? (stats.totalProcessed / duration).toFixed(2) : '0';

  console.log(`\n📈 Progress: ${stats.successful}/${stats.totalProcessed} successful (${stats.failed} failed) | ${rate} wallets/sec`);
}

/**
 * Print final summary
 */
function printSummary(): void {
  const duration = (Date.now() - stats.startTime.getTime()) / 1000;

  console.log('\n' + '='.repeat(60));
  console.log('📊 PROCESSING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Processed:   ${stats.totalProcessed}`);
  console.log(`Successful:        ${stats.successful} (${((stats.successful / stats.totalProcessed) * 100).toFixed(1)}%)`);
  console.log(`Failed:            ${stats.failed}`);
  console.log(`Duration:          ${duration.toFixed(1)}s`);
  console.log(`Average Rate:      ${(stats.totalProcessed / duration).toFixed(2)} wallets/sec`);
  console.log('='.repeat(60));
  console.log('\n✅ Processing complete!\n');
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const continuous = args.includes('--continuous');

  if (continuous) {
    console.log('🔄 Running in continuous mode (Ctrl+C to stop)');

    // Run forever
    while (true) {
      try {
        await processQueue();

        // Wait before next cycle
        console.log('\n⏸️  Waiting 10 minutes before next cycle...');
        await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));

        // Reset stats for next cycle
        stats.totalProcessed = 0;
        stats.successful = 0;
        stats.failed = 0;
        stats.startTime = new Date();
      } catch (error) {
        console.error('\n❌ Error in continuous loop:', error);
        console.log('⏸️  Waiting 5 minutes before retry...');
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
      }
    }
  } else {
    // Run once
    try {
      await processQueue();
    } catch (error) {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main();
}

export { processQueue, fetchWalletsToProcess };
