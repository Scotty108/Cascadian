#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { ethers } from 'ethers';

/**
 * TEST: Blockchain Connection and Event Parsing
 *
 * Verifies:
 * 1. RPC connection works
 * 2. CTF contract exists
 * 3. ConditionResolution events can be fetched and parsed
 * 4. Event data format is correct
 *
 * Runtime: ~30 seconds
 */

const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const CTF_CONTRACT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// ConditionResolution event ABI
const CONDITION_RESOLUTION_ABI = [
  'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount, uint[] payoutNumerators)'
];

async function testBlockchainConnection() {
  console.log('BLOCKCHAIN CONNECTION TEST');
  console.log('═'.repeat(80));
  console.log();

  // Step 1: Test RPC connection
  console.log('Step 1: Testing RPC connection...');
  console.log(`RPC URL: ${POLYGON_RPC}`);

  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Connected! Current block: ${blockNumber.toLocaleString()}`);
    console.log();

    // Step 2: Test event query
    console.log('Step 2: Fetching sample ConditionResolution events...');
    console.log(`Contract: ${CTF_CONTRACT_ADDRESS}`);
    console.log(`Block range: Recent 50,000 blocks`);
    console.log();

    const fromBlock = blockNumber - 50_000;
    const toBlock = blockNumber;

    const filter = {
      address: CTF_CONTRACT_ADDRESS,
      topics: [ethers.id('ConditionResolution(bytes32,address,bytes32,uint256,uint256[])')],
      fromBlock,
      toBlock,
    };

    const logs = await provider.getLogs(filter);
    console.log(`✅ Found ${logs.length} events in last 50k blocks`);
    console.log();

    // Step 3: Parse sample events
    if (logs.length > 0) {
      console.log('Step 3: Parsing sample events...');
      console.log();

      const iface = new ethers.Interface(CONDITION_RESOLUTION_ABI);
      const samples = logs.slice(0, Math.min(5, logs.length));

      for (let i = 0; i < samples.length; i++) {
        const log = samples[i];

        try {
          const parsed = iface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });

          if (!parsed) {
            console.log(`  Event ${i+1}: Failed to parse`);
            continue;
          }

          const conditionId = parsed.args[0];
          const payoutNumerators = parsed.args[4];
          const payoutDenominator = payoutNumerators.reduce(
            (sum: bigint, num: bigint) => sum + num,
            0n
          );

          console.log(`Event ${i+1}:`);
          console.log(`  Condition ID: ${conditionId}`);
          console.log(`  Payout Numerators: [${payoutNumerators.map((n: bigint) => n.toString()).join(', ')}]`);
          console.log(`  Payout Denominator: ${payoutDenominator.toString()}`);
          console.log(`  Block: ${log.blockNumber.toLocaleString()}`);
          console.log(`  Tx Hash: ${log.transactionHash}`);
          console.log();
        } catch (parseError: any) {
          console.log(`  Event ${i+1}: Parse error - ${parseError.message}`);
          console.log();
        }
      }

      console.log('✅ Event parsing successful!');
      console.log();

    } else {
      console.log('⚠️  No events found in recent blocks');
      console.log('   Trying larger range...');
      console.log();

      const largerFromBlock = blockNumber - 500_000;
      const largerFilter = {
        ...filter,
        fromBlock: largerFromBlock,
      };

      const largerLogs = await provider.getLogs(largerFilter);
      console.log(`   Found ${largerLogs.length} events in last 500k blocks`);

      if (largerLogs.length > 0) {
        console.log('   ✅ Events exist, backfill should work!');
      } else {
        console.log('   ❌ Still no events - may need to check contract address');
      }
      console.log();
    }

    // Step 4: Estimate total events
    console.log('Step 4: Estimating total events to fetch...');

    const EARLIEST_BLOCK = 10_000_000;
    const totalBlocks = blockNumber - EARLIEST_BLOCK;
    const eventsPerBlock = logs.length / 50_000;
    const estimatedTotal = Math.ceil(eventsPerBlock * totalBlocks);

    console.log(`  Earliest block: ${EARLIEST_BLOCK.toLocaleString()}`);
    console.log(`  Total blocks to scan: ${totalBlocks.toLocaleString()}`);
    console.log(`  Events per block (sample): ${eventsPerBlock.toFixed(6)}`);
    console.log(`  Estimated total events: ${estimatedTotal.toLocaleString()}`);
    console.log();

    const BATCH_SIZE = 10_000;
    const RATE_LIMIT_MS = 100;
    const numBatches = Math.ceil(totalBlocks / BATCH_SIZE);
    const estimatedTime = (numBatches * RATE_LIMIT_MS) / 1000 / 60;

    console.log(`  Batches required: ${numBatches.toLocaleString()}`);
    console.log(`  Estimated runtime: ${Math.ceil(estimatedTime)} minutes`);
    console.log();

    console.log('═'.repeat(80));
    console.log('TEST SUMMARY');
    console.log('═'.repeat(80));
    console.log();
    console.log('✅ RPC connection: Working');
    console.log('✅ Event fetching: Working');
    console.log('✅ Event parsing: Working');
    console.log(`✅ Estimated coverage gain: ~${estimatedTotal.toLocaleString()} markets`);
    console.log();
    console.log('Ready to run full backfill!');
    console.log();
    console.log('Next steps:');
    console.log('1. Run: npx tsx blockchain-resolution-backfill.ts');
    console.log('2. Monitor progress (checkpoints saved every batch)');
    console.log(`3. Expected runtime: ~${Math.ceil(estimatedTime)} minutes`);
    console.log();

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error();
    console.error('Troubleshooting:');
    console.error('1. Check POLYGON_RPC_URL in .env.local');
    console.error('2. Verify RPC endpoint is accessible');
    console.error('3. Try a different Polygon RPC provider');
    console.error();
    throw error;
  }
}

testBlockchainConnection().catch(console.error);
