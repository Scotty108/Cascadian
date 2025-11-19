#!/usr/bin/env npx tsx
/**
 * Estimate time to refetch remaining 49,071 blocks
 * 
 * Based on:
 * - Previous session: 2.65M blocks in ~50-55 minutes with 16 workers
 * - Batch size: 25-50 blocks per RPC call (safe limits)
 * - Workers: 4-8 (to avoid rate limiting)
 * - Rate limiting: 2 req/sec across all endpoints
 */

const REMAINING_BLOCKS = 49_071;
const BATCH_SIZE = 25; // conservative
const WORKERS = 8;
const REQUESTS_PER_SEC = 2; // total across all endpoints
const ENDPOINT_COUNT = 5;
const RETRY_OVERHEAD = 1.3; // 30% overhead for retries
const CHECKPOINT_INTERVAL = 1000;

console.log('⏱️  Refetch Time Estimation\n');
console.log('═'.repeat(60));

// Calculate batches needed
const batches = Math.ceil(REMAINING_BLOCKS / BATCH_SIZE);
console.log(`\n📊 Batch Calculation:`);
console.log(`  Total blocks: ${REMAINING_BLOCKS.toLocaleString()}`);
console.log(`  Batch size: ${BATCH_SIZE} blocks`);
console.log(`  Total batches: ${batches.toLocaleString()}`);

// Parallel execution
const batchesPerWorker = Math.ceil(batches / WORKERS);
console.log(`\n⚙️  Parallel Execution (${WORKERS} workers):`);
console.log(`  Batches per worker: ${batchesPerWorker}`);

// Rate limiting impact
const secondsBetweenRequests = 1 / REQUESTS_PER_SEC;
const secondsPerBatch = secondsBetweenRequests;
const timePerWorkerSeconds = batchesPerWorker * secondsPerBatch;
const timePerWorkerMinutes = (timePerWorkerSeconds / 60).toFixed(1);

console.log(`\n🔄 Rate Limiting (${REQUESTS_PER_SEC} req/sec across endpoints):`);
console.log(`  Seconds between requests: ${secondsBetweenRequests}`);
console.log(`  Time per worker (no retries): ${timePerWorkerMinutes} minutes`);

// With retries and exponential backoff
const withRetriesSeconds = timePerWorkerSeconds * RETRY_OVERHEAD;
const withRetriesMinutes = (withRetriesSeconds / 60).toFixed(1);

console.log(`\n🔁 With Retry Overhead (${((RETRY_OVERHEAD - 1) * 100).toFixed(0)}%):`);
console.log(`  Estimated time: ${withRetriesMinutes} minutes`);

// Checkpointing
const checkpoints = Math.ceil(REMAINING_BLOCKS / CHECKPOINT_INTERVAL);
console.log(`\n💾 Checkpointing (every ${CHECKPOINT_INTERVAL} blocks):`);
console.log(`  Checkpoints: ${checkpoints}`);
console.log(`  Resume capability: Yes (if interrupted)`);

// Summary
console.log(`\n📈 Time Estimates:`);
console.log(`  Optimistic (no errors): ${(timePerWorkerSeconds / 60).toFixed(0)} minutes`);
console.log(`  Realistic (with retries): ${withRetriesMinutes} minutes`);
console.log(`  Conservative (heavy retries): ${(withRetriesSeconds * 1.5 / 60).toFixed(0)} minutes`);

// Comparison to original
console.log(`\n📊 Comparison to Original Session:`);
const originalBlocks = 2_650_000;
const originalTime = 52.5; // minutes
const originalBlocksPerMin = originalBlocks / originalTime;
const estimatedFromOriginal = REMAINING_BLOCKS / originalBlocksPerMin;
console.log(`  Original: ${originalBlocks.toLocaleString()} blocks in ${originalTime} min`);
console.log(`  Rate: ${originalBlocksPerMin.toFixed(0)} blocks/min`);
console.log(`  For 49,071 blocks: ${estimatedFromOriginal.toFixed(0)} minutes`);

console.log(`\n═`.repeat(60));
console.log(`\n✅ RECOMMENDATION: Plan for ${withRetriesMinutes} minutes`);
console.log(`   (Safe buffer: ${(parseFloat(withRetriesMinutes) * 1.5).toFixed(0)} minutes with margin)`);
console.log(`   Run at: ${new Date(Date.now() + 5 * 60000).toLocaleTimeString()}\n`);
