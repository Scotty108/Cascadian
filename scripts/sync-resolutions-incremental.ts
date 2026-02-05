#!/usr/bin/env npx tsx
/**
 * Sync new resolutions from Polygon blockchain to pm_condition_resolutions
 *
 * Uses Alchemy RPC for reliability. Fetches ConditionResolution events
 * from the last synced block to current.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';
import { ethers } from 'ethers';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000,
});

// Use Alchemy RPC for reliability
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO';
const provider = new ethers.JsonRpcProvider(POLYGON_RPC);

// CTF Contract on Polygon
const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// ConditionResolution event ABI
const CONDITION_RESOLUTION_ABI = [
  'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount, uint256[] payoutNumerators)'
];
const iface = new ethers.Interface(CONDITION_RESOLUTION_ABI);

// Alchemy free tier limits to 10 blocks per request
const BLOCKS_PER_BATCH = 10;

interface Resolution {
  condition_id: string;
  payout_numerators: string;
  payout_denominator: string;
  resolved_at: string;
  block_number: number;
  tx_hash: string;
}

async function getLastSyncedBlock(): Promise<number> {
  const result = await client.query({
    query: 'SELECT max(block_number) as last_block FROM pm_condition_resolutions WHERE is_deleted = 0',
    format: 'JSONEachRow',
  });
  const rows = await result.json() as any[];
  return rows[0]?.last_block || 10000000;
}

async function fetchResolutions(fromBlock: number, toBlock: number): Promise<Resolution[]> {
  const filter = {
    address: CTF_CONTRACT,
    topics: [ethers.id('ConditionResolution(bytes32,address,bytes32,uint256,uint256[])')],
    fromBlock,
    toBlock,
  };

  const logs = await provider.getLogs(filter);
  const resolutions: Resolution[] = [];

  for (const log of logs) {
    try {
      const parsed = iface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });

      if (!parsed) continue;

      const conditionId = parsed.args[0];
      const payoutNumerators = parsed.args[4] as bigint[];
      const payoutDenominator = payoutNumerators.reduce((sum, n) => sum + n, 0n);

      if (payoutDenominator === 0n) continue;

      // Get block timestamp
      const block = await provider.getBlock(log.blockNumber);
      const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);

      resolutions.push({
        condition_id: conditionId.toLowerCase().replace('0x', ''),
        payout_numerators: JSON.stringify(payoutNumerators.map(n => n.toString())),
        payout_denominator: payoutDenominator.toString(),
        resolved_at: new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19),
        block_number: log.blockNumber,
        tx_hash: log.transactionHash,
      });
    } catch (e) {
      // Skip unparseable events
    }
  }

  return resolutions;
}

async function insertResolutions(resolutions: Resolution[]) {
  if (resolutions.length === 0) return;

  const values = resolutions.map(r => ({
    condition_id: r.condition_id,
    payout_numerators: r.payout_numerators,
    payout_denominator: r.payout_denominator,
    resolved_at: r.resolved_at,
    block_number: r.block_number,
    tx_hash: r.tx_hash,
    is_deleted: 0,
  }));

  await client.insert({
    table: 'pm_condition_resolutions',
    values,
    format: 'JSONEachRow',
  });
}

async function main() {
  console.log('🔄 Syncing new resolutions from Polygon blockchain\n');
  console.log(`RPC: ${POLYGON_RPC.substring(0, 50)}...`);

  const lastBlock = await getLastSyncedBlock();
  const currentBlock = await provider.getBlockNumber();

  console.log(`\nLast synced: block ${lastBlock.toLocaleString()}`);
  console.log(`Current:     block ${currentBlock.toLocaleString()}`);

  const blocksToProcess = currentBlock - lastBlock;
  console.log(`Blocks to sync: ${blocksToProcess.toLocaleString()}\n`);

  if (blocksToProcess <= 0) {
    console.log('✅ Already up to date!');
    await client.close();
    return;
  }

  let totalInserted = 0;
  let from = lastBlock + 1;
  let batchCount = 0;
  const totalBatches = Math.ceil(blocksToProcess / BLOCKS_PER_BATCH);
  let errorCount = 0;

  while (from <= currentBlock) {
    const to = Math.min(from + BLOCKS_PER_BATCH - 1, currentBlock);
    batchCount++;

    // Only log every 100 batches or when we find resolutions
    const shouldLog = batchCount % 100 === 0 || batchCount === totalBatches;

    try {
      const resolutions = await fetchResolutions(from, to);

      if (resolutions.length > 0) {
        await insertResolutions(resolutions);
        totalInserted += resolutions.length;
        console.log(`  [${batchCount}/${totalBatches}] Block ${to.toLocaleString()}: +${resolutions.length} resolutions (total: ${totalInserted})`);
      } else if (shouldLog) {
        process.stdout.write(`\r  [${batchCount}/${totalBatches}] Block ${to.toLocaleString()} - ${totalInserted} resolutions found...`);
      }
    } catch (error: any) {
      errorCount++;
      if (errorCount <= 5) {
        console.log(`\n  Error at block ${from}: ${error.message.substring(0, 80)}`);
      }
      // Wait and continue on error
      await new Promise(r => setTimeout(r, 1000));
    }

    from = to + 1;

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(); // New line after progress

  console.log(`\n✅ Synced ${totalInserted} new resolutions`);

  // Verify
  const result = await client.query({
    query: 'SELECT count() as cnt, max(resolved_at) as latest FROM pm_condition_resolutions WHERE is_deleted = 0',
    format: 'JSONEachRow',
  });
  const stats = (await result.json() as any[])[0];
  console.log(`\n📊 Total resolutions: ${parseInt(stats.cnt).toLocaleString()}`);
  console.log(`   Latest: ${stats.latest}`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
