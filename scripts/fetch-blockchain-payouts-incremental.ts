#!/usr/bin/env npx tsx
/**
 * Incremental Blockchain Payout Fetcher
 * 
 * Fetches only NEW ConditionResolution events since last run
 * Runtime: <30 seconds (vs 5-10 min for full backfill)
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { ethers } from 'ethers';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

interface PayoutVector {
  condition_id: string;
  payout_numerators: number[];
  payout_denominator: number;
  block_number: number;
  block_timestamp: Date;
  tx_hash: string;
}

async function main() {
  console.log('\n⚡ INCREMENTAL RESOLUTION FETCH\n');
  console.log('═'.repeat(80));

  // Get last processed block
  console.log('\n1️⃣ Finding last processed block:\n');

  const lastBlockQuery = await ch.query({
    query: `
      SELECT MAX(block_number) as last_block
      FROM default.resolutions_external_ingest
      WHERE source = 'blockchain'
    `,
    format: 'JSONEachRow'
  });

  const lastBlockData = await lastBlockQuery.json();
  const fromBlock = lastBlockData[0].last_block ? parseInt(lastBlockData[0].last_block) + 1 : 15000000;

  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
  const toBlock = await provider.getBlockNumber();

  console.log('  Last processed: ' + (fromBlock - 1).toLocaleString());
  console.log('  Current block: ' + toBlock.toLocaleString());
  console.log('  New blocks: ' + (toBlock - fromBlock).toLocaleString() + '\n');

  if (toBlock - fromBlock < 1) {
    console.log('✅ No new blocks - already up to date\n');
    await ch.close();
    return;
  }

  // Fetch new events
  console.log('2️⃣ Fetching ConditionResolution events:\n');

  const iface = new ethers.Interface([
    'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, uint256 questionId, uint256[] payoutNumerators)'
  ]);

  try {
    const logs = await provider.getLogs({
      address: CTF_ADDRESS,
      topics: [ethers.id('ConditionResolution(bytes32,address,uint256,uint256[])')],
      fromBlock,
      toBlock
    });

    console.log('  Found ' + logs.length + ' new resolution events\n');

    if (logs.length === 0) {
      console.log('✅ No new resolutions\n');
      await ch.close();
      return;
    }

    // Parse events
    const payoutVectors: PayoutVector[] = [];

    for (const log of logs) {
      const decoded = iface.parseLog({
        topics: log.topics,
        data: log.data
      });

      if (decoded) {
        const conditionId = decoded.args.conditionId.toLowerCase().replace('0x', '');
        const payoutNumerators = decoded.args.payoutNumerators.map((n: bigint) => Number(n));
        const payoutDenominator = payoutNumerators.reduce((a: number, b: number) => a + b, 0);

        const block = await provider.getBlock(log.blockNumber);

        payoutVectors.push({
          condition_id: conditionId,
          payout_numerators: payoutNumerators,
          payout_denominator: payoutDenominator,
          block_number: log.blockNumber,
          block_timestamp: new Date((block?.timestamp || 0) * 1000),
          tx_hash: log.transactionHash
        });

        console.log('  ✓ ' + conditionId.substring(0, 16) + '... (block ' + log.blockNumber + ')');
      }
    }

    // Insert new resolutions
    if (payoutVectors.length > 0) {
      console.log('\n3️⃣ Inserting new resolutions:\n');

      const rows = payoutVectors.map(pv => ({
        condition_id: pv.condition_id,
        payout_numerators: pv.payout_numerators,
        payout_denominator: pv.payout_denominator,
        winning_index: pv.payout_numerators.findIndex(n => n > 0),
        resolved_at: pv.block_timestamp,
        source: 'blockchain',
        fetched_at: new Date()
      }));

      await ch.insert({
        table: 'default.resolutions_external_ingest',
        values: rows,
        format: 'JSONEachRow'
      });

      console.log('  ✅ Inserted ' + payoutVectors.length + ' new resolutions\n');
    }

    console.log('═'.repeat(80));
    console.log('\n✅ INCREMENTAL FETCH COMPLETE\n');
    console.log('Blocks processed: ' + fromBlock.toLocaleString() + ' → ' + toBlock.toLocaleString());
    console.log('New resolutions: ' + payoutVectors.length + '\n');
    console.log('═'.repeat(80) + '\n');

  } catch (error: any) {
    console.error('\n❌ Error fetching events:', error.message);
    console.log('\nRetry strategies:');
    console.log('  1. Reduce block range (split into smaller chunks)');
    console.log('  2. Use premium RPC (Alchemy/Infura)');
    console.log('  3. Increase timeout in provider config\n');
  }

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
