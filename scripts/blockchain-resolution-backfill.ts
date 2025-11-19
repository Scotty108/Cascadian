#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';
import { ethers } from 'ethers';

/**
 * BLOCKCHAIN RESOLUTION BACKFILL
 *
 * Fetches ConditionResolution events from Polygon CTF contract
 * to build comprehensive resolution coverage.
 *
 * Strategy:
 * 1. Query ConditionResolution events from CTF contract in batches
 * 2. Parse payout vectors from event logs
 * 3. Insert into market_resolutions_final
 * 4. Rebuild views for production use
 *
 * Expected coverage gain: +300k-400k markets (80%+ total)
 * Runtime: 2-4 hours (depends on RPC rate limits)
 */

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 300000, // 5 minutes timeout for large inserts
});

// Polygon RPC (using public or your configured endpoint)
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const provider = new ethers.JsonRpcProvider(POLYGON_RPC);

// CTF Contract on Polygon
const CTF_CONTRACT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// ConditionResolution event ABI
const CONDITION_RESOLUTION_ABI = [
  'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount, uint[] payoutNumerators)'
];

const iface = new ethers.Interface(CONDITION_RESOLUTION_ABI);

// Configuration (with environment variable overrides for multi-worker)
const WORKER_ID = process.env.WORKER_ID || '0';
const FROM_BLOCK = parseInt(process.env.FROM_BLOCK || '10000000');
const TO_BLOCK = parseInt(process.env.TO_BLOCK || '0'); // 0 = current block
const BLOCKS_PER_BATCH = parseInt(process.env.BLOCKS_PER_BATCH || '20000'); // 20k for Alchemy
const BATCH_INSERT_SIZE = 500; // Insert 500 resolutions at a time (keep stable)
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '40'); // 40ms = ~25 req/sec per worker
const CHECKPOINT_FILE = process.env.CHECKPOINT_FILE || `./blockchain-backfill-checkpoint-${WORKER_ID}.json`;

interface Resolution {
  condition_id: string;
  oracle_address: string;
  question_id: string;
  outcome_slot_count: number;
  payout_numerators: number[];
  payout_denominator: number;
  block_number: number;
  tx_hash: string;
  timestamp: number;
  log_index: number;
}

interface Checkpoint {
  lastBlock: number;
  totalProcessed: number;
  totalInserted: number;
  startTime: number;
}

// Load checkpoint if exists
function loadCheckpoint(): Checkpoint | null {
  try {
    const fs = require('fs');
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    }
  } catch (error) {
    console.log('No checkpoint found, starting fresh');
  }
  return null;
}

// Save checkpoint
function saveCheckpoint(checkpoint: Checkpoint) {
  const fs = require('fs');
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function getCurrentBlock(): Promise<number> {
  return await provider.getBlockNumber();
}

async function fetchResolutionEvents(
  fromBlock: number,
  toBlock: number
): Promise<Resolution[]> {
  console.log(`  Fetching events from block ${fromBlock.toLocaleString()} to ${toBlock.toLocaleString()}...`);

  const filter = {
    address: CTF_CONTRACT_ADDRESS,
    topics: [ethers.id('ConditionResolution(bytes32,address,bytes32,uint256,uint256[])')],
    fromBlock,
    toBlock,
  };

  try {
    const logs = await provider.getLogs(filter);

    const resolutions: Resolution[] = [];

    for (const log of logs) {
      try {
        const parsed = iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed) continue;

        const conditionId = parsed.args[0]; // bytes32 indexed
        const oracleAddress = parsed.args[1]; // address indexed
        const questionId = parsed.args[2]; // bytes32 indexed
        const outcomeSlotCount = parsed.args[3]; // uint256
        const payoutNumerators = parsed.args[4]; // uint256[]

        // Calculate payout denominator (sum of all numerators)
        const payoutDenominator = payoutNumerators.reduce(
          (sum: bigint, num: bigint) => sum + num,
          0n
        );

        // Skip if denominator is 0 (invalid resolution)
        if (payoutDenominator === 0n) continue;

        // Get block timestamp
        const block = await provider.getBlock(log.blockNumber);
        const timestamp = block?.timestamp || 0;

        resolutions.push({
          condition_id: conditionId.toLowerCase().replace('0x', ''),
          oracle_address: oracleAddress.toLowerCase(),
          question_id: questionId.toLowerCase().replace('0x', ''),
          outcome_slot_count: Number(outcomeSlotCount),
          payout_numerators: payoutNumerators.map((n: bigint) => Number(n)),
          payout_denominator: Number(payoutDenominator),
          block_number: log.blockNumber,
          tx_hash: log.transactionHash,
          timestamp,
          log_index: log.index,
        });
      } catch (parseError: any) {
        console.error(`Failed to parse log: ${parseError.message}`);
        continue;
      }
    }

    console.log(`    Found ${resolutions.length} resolutions`);
    return resolutions;
  } catch (error: any) {
    console.error(`  Error fetching events: ${error.message}`);
    // If rate limited, wait and retry
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      console.log('  Rate limited, waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      return fetchResolutionEvents(fromBlock, toBlock);
    }
    throw error;
  }
}

async function insertResolutions(resolutions: Resolution[]) {
  if (resolutions.length === 0) return;

  console.log(`  Inserting ${resolutions.length} resolutions into database...`);

  // Filter out invalid resolutions and calculate winning_index safely
  // FIXED: Match actual market_resolutions_final schema
  const values = resolutions
    .map(r => {
      const winningIdx = r.payout_numerators.findIndex((n: number) => n === r.payout_denominator);
      return {
        condition_id_norm: r.condition_id,
        payout_numerators: r.payout_numerators,
        payout_denominator: r.payout_denominator,
        outcome_count: r.outcome_slot_count,  // Map to outcome_count (actual field name)
        winning_outcome: '',
        source: 'blockchain',
        version: 1,  // Add version field
        resolved_at: new Date(r.timestamp * 1000).toISOString(),
        updated_at: new Date().toISOString(),
        winning_index: winningIdx >= 0 ? winningIdx : 0,  // Use 0 for unresolved
      };
    })
    // Only insert markets with valid payout data
    .filter(v => v.payout_denominator > 0 && v.payout_numerators.length > 0);

  await client.insert({
    table: 'default.market_resolutions_final',
    values,
    format: 'JSONEachRow',
  });

  console.log(`  ✅ Inserted successfully`);
}

async function main() {
  console.log(`BLOCKCHAIN RESOLUTION BACKFILL [Worker ${WORKER_ID}]`);
  console.log('═'.repeat(100));
  console.log();
  console.log('Strategy: Fetch ConditionResolution events from Polygon CTF contract');
  console.log(`Contract: ${CTF_CONTRACT_ADDRESS}`);
  console.log(`RPC: ${POLYGON_RPC}`);
  console.log(`Worker ID: ${WORKER_ID}`);
  console.log();

  // Get target block (use env var or current block)
  const currentBlock = TO_BLOCK > 0 ? TO_BLOCK : await getCurrentBlock();
  console.log(`Target block range: ${FROM_BLOCK.toLocaleString()} → ${currentBlock.toLocaleString()}`);
  console.log(`Blocks per batch: ${BLOCKS_PER_BATCH.toLocaleString()}`);
  console.log(`Rate limit: ${RATE_LIMIT_MS}ms (~${Math.round(1000/RATE_LIMIT_MS)} req/sec)`);
  console.log();

  // Load checkpoint or start fresh
  let checkpoint = loadCheckpoint();
  const startBlock = checkpoint?.lastBlock || FROM_BLOCK;
  let totalProcessed = checkpoint?.totalProcessed || 0;
  let totalInserted = checkpoint?.totalInserted || 0;
  const startTime = checkpoint?.startTime || Date.now();

  console.log(`Starting from block: ${startBlock.toLocaleString()}`);
  console.log(`Total blocks to scan: ${(currentBlock - startBlock).toLocaleString()}`);
  console.log(`Estimated batches: ${Math.ceil((currentBlock - startBlock) / BLOCKS_PER_BATCH)}`);
  console.log();

  // Batch processing
  let currentBatchStart = startBlock;
  let batchNumber = 0;
  let resolutionBatch: Resolution[] = [];

  while (currentBatchStart < currentBlock) {
    batchNumber++;
    const batchEnd = Math.min(currentBatchStart + BLOCKS_PER_BATCH, currentBlock);

    console.log(`Batch ${batchNumber} | Blocks ${currentBatchStart.toLocaleString()} → ${batchEnd.toLocaleString()}`);

    try {
      // Fetch events for this block range
      const resolutions = await fetchResolutionEvents(currentBatchStart, batchEnd);

      totalProcessed += resolutions.length;
      resolutionBatch.push(...resolutions);

      // Insert when batch is full
      if (resolutionBatch.length >= BATCH_INSERT_SIZE) {
        await insertResolutions(resolutionBatch);
        totalInserted += resolutionBatch.length;
        resolutionBatch = [];
      }

      // Save checkpoint
      checkpoint = {
        lastBlock: batchEnd,
        totalProcessed,
        totalInserted,
        startTime,
      };
      saveCheckpoint(checkpoint);

      // Progress report
      const elapsed = (Date.now() - startTime) / 1000;
      const blocksProcessed = batchEnd - startBlock;
      const blocksRemaining = currentBlock - batchEnd;
      const blocksPerSec = blocksProcessed / elapsed;
      const etaSeconds = blocksRemaining / blocksPerSec;

      console.log(`  Progress: ${((blocksProcessed / (currentBlock - startBlock)) * 100).toFixed(1)}%`);
      console.log(`  Resolutions found: ${totalProcessed.toLocaleString()}`);
      console.log(`  Resolutions inserted: ${totalInserted.toLocaleString()}`);
      console.log(`  ETA: ${Math.ceil(etaSeconds / 60)} minutes`);
      console.log();

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));

      currentBatchStart = batchEnd + 1;
    } catch (error: any) {
      console.error(`❌ Batch ${batchNumber} failed: ${error.message}`);
      console.log('Saving checkpoint and exiting...');
      saveCheckpoint(checkpoint!);
      throw error;
    }
  }

  // Insert remaining resolutions
  if (resolutionBatch.length > 0) {
    await insertResolutions(resolutionBatch);
    totalInserted += resolutionBatch.length;
  }

  console.log('═'.repeat(100));
  console.log('BACKFILL COMPLETE!');
  console.log('═'.repeat(100));
  console.log();
  console.log(`Total blocks scanned: ${(currentBlock - startBlock).toLocaleString()}`);
  console.log(`Total resolutions found: ${totalProcessed.toLocaleString()}`);
  console.log(`Total resolutions inserted: ${totalInserted.toLocaleString()}`);
  console.log(`Total time: ${Math.ceil((Date.now() - startTime) / 1000 / 60)} minutes`);
  console.log();

  // Check coverage improvement
  console.log('Checking coverage improvement...');
  console.log();

  const coverage = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total_markets,
        (SELECT count(DISTINCT lower(condition_id_norm))
         FROM default.market_resolutions_final) AS resolved_markets,
        (SELECT count(DISTINCT t.condition_id_norm)
         FROM default.vw_trades_canonical t
         INNER JOIN default.market_resolutions_final r
           ON lower(t.condition_id_norm) = lower(r.condition_id_norm)
         WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS matched_markets
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<any[]>())[0];
  const coveragePct = (100 * cov.matched_markets / cov.total_markets).toFixed(1);

  console.log('COVERAGE REPORT:');
  console.log('─'.repeat(100));
  console.log(`Total markets traded:        ${cov.total_markets.toLocaleString()}`);
  console.log(`Markets with resolutions:    ${cov.resolved_markets.toLocaleString()}`);
  console.log(`Matched (traded + resolved): ${cov.matched_markets.toLocaleString()} (${coveragePct}%)`);
  console.log();

  if (parseFloat(coveragePct) >= 80) {
    console.log('🎉🎉🎉 SUCCESS! Coverage ≥ 80% - PRODUCTION READY!');
  } else if (parseFloat(coveragePct) >= 60) {
    console.log('✅ Good progress! Coverage ≥ 60% - Consider running test wallets');
  } else {
    console.log('⚠️  Coverage still low - May need additional sources');
  }
  console.log();

  // Rebuild vw_resolutions_unified view
  console.log('Rebuilding vw_resolutions_unified view...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_unified AS
      SELECT
        lower(concat('0x', condition_id_norm)) AS cid_hex,
        argMax(winning_index, updated_at) as winning_index,
        argMax(payout_numerators, updated_at) as payout_numerators,
        argMax(payout_denominator, updated_at) as payout_denominator,
        argMax(resolved_at, updated_at) as resolved_at,
        argMax(source, updated_at) as source
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      GROUP BY cid_hex
    `,
  });
  console.log('✅ vw_resolutions_unified rebuilt');
  console.log();

  console.log('Next steps:');
  console.log('1. Re-run wallet coverage test: npx tsx check-missing-wallet-data.ts');
  console.log('2. Re-run P&L comparison: npx tsx test-pnl-calculations-vs-polymarket.ts');
  console.log('3. If coverage ≥ 80%, ship P&L feature! 🚀');
  console.log();

  // Clean up checkpoint file
  const fs = require('fs');
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
    console.log('Checkpoint file cleaned up');
  }

  await client.close();
}

main().catch(console.error);
