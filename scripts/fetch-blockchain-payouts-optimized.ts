#!/usr/bin/env npx tsx
/**
 * Fetch Blockchain Payouts - Optimized Version
 *
 * Fetches ALL ConditionResolution events in block range batches,
 * then filters to the missing condition_ids we care about.
 * Much faster than individual queries.
 *
 * Runtime: ~5-10 minutes (vs 30-45 min for individual queries)
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

// CTF contract on Polygon
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

// ConditionResolution event signature
const CONDITION_RESOLUTION_EVENT = 'ConditionResolution(bytes32,address,uint256,uint256[])';
const EVENT_TOPIC = ethers.id(CONDITION_RESOLUTION_EVENT);

interface PayoutVector {
  condition_id: string;
  payout_numerators: number[];
  payout_denominator: number;
  block_number: number;
  block_timestamp: Date;
  tx_hash: string;
}

async function main() {
  console.log('\n⛓️  FETCHING BLOCKCHAIN PAYOUTS (OPTIMIZED)\n');
  console.log('═'.repeat(80));

  // Step 1: Get missing condition_ids
  console.log('\n1️⃣ Identifying missing markets:\n');

  const missingMarkets = await ch.query({
    query: `
      WITH
        traded_ids AS (
          SELECT DISTINCT
            lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        ),
        known_markets AS (
          SELECT DISTINCT
            lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.api_markets_staging
        ),
        known_resolutions AS (
          SELECT DISTINCT
            lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          UNION ALL
          SELECT DISTINCT
            lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
        )
      SELECT DISTINCT t.cid_norm as condition_id
      FROM traded_ids t
      LEFT JOIN known_markets m ON t.cid_norm = m.cid_norm
      LEFT JOIN known_resolutions r ON t.cid_norm = r.cid_norm
      WHERE m.cid_norm IS NULL
        AND r.cid_norm IS NULL
      ORDER BY t.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const missingData = await missingMarkets.json<any>();
  const totalMissing = missingData.length;

  console.log(`  Found ${totalMissing.toLocaleString()} markets needing blockchain lookup\n`);

  if (totalMissing === 0) {
    console.log('✅ No missing markets!\n');
    await ch.close();
    return;
  }

  // Create lookup set for fast filtering
  const missingSet = new Set(missingData.map((r: any) => r.condition_id.toLowerCase()));

  // Step 2: Connect to blockchain
  console.log('2️⃣ Connecting to Polygon:\n');

  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);

  try {
    const latestBlock = await provider.getBlockNumber();
    console.log(`  ✅ Connected (latest block: ${latestBlock.toLocaleString()})\n`);
  } catch (e: any) {
    console.error(`  ❌ Connection failed: ${e.message}\n`);
    await ch.close();
    return;
  }

  // Step 3: Fetch ALL ConditionResolution events in batches
  console.log('3️⃣ Fetching ConditionResolution events in batches:\n');
  console.log('  Strategy: Fetch all events, filter to missing condition_ids\n');

  const payoutVectors: PayoutVector[] = [];
  const fromBlock = 15000000; // CTF deployed around here
  const latestBlock = await provider.getBlockNumber();
  const blockRange = 500000; // Fetch 500K blocks at a time

  const batches = Math.ceil((latestBlock - fromBlock) / blockRange);

  const iface = new ethers.Interface([
    'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, uint256 questionId, uint256[] payoutNumerators)'
  ]);

  for (let i = 0; i < batches; i++) {
    const start = fromBlock + (i * blockRange);
    const end = Math.min(start + blockRange, latestBlock);

    console.log(`  Batch ${i + 1}/${batches}: Blocks ${start.toLocaleString()} - ${end.toLocaleString()}`);

    try {
      const logs = await provider.getLogs({
        address: CTF_ADDRESS,
        topics: [EVENT_TOPIC],
        fromBlock: start,
        toBlock: end
      });

      console.log(`    Found ${logs.length} resolution events`);

      // Filter to missing condition_ids and parse
      for (const log of logs) {
        const decoded = iface.parseLog({
          topics: log.topics,
          data: log.data
        });

        if (decoded) {
          const conditionId = decoded.args.conditionId.toLowerCase().replace('0x', '');

          // Only process if this is one of our missing markets
          if (missingSet.has(conditionId)) {
            const payoutNumerators = decoded.args.payoutNumerators.map((n: bigint) => Number(n));
            const payoutDenominator = payoutNumerators.reduce((a: number, b: number) => a + b, 0);

            // Get block timestamp
            const block = await provider.getBlock(log.blockNumber);

            payoutVectors.push({
              condition_id: conditionId,
              payout_numerators: payoutNumerators,
              payout_denominator: payoutDenominator,
              block_number: log.blockNumber,
              block_timestamp: new Date((block?.timestamp || 0) * 1000),
              tx_hash: log.transactionHash
            });

            console.log(`    ✓ Found: ${conditionId.substring(0, 16)}...`);
          }
        }
      }

      console.log(`    Running total: ${payoutVectors.length} payouts found for missing markets`);

    } catch (e: any) {
      console.error(`    ⚠️  Batch error: ${e.message}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n  ✅ Fetch complete!\n`);
  console.log(`  Statistics:`);
  console.log(`    Missing markets: ${totalMissing.toLocaleString()}`);
  console.log(`    Found on-chain: ${payoutVectors.length.toLocaleString()}`);
  console.log(`    Not found: ${(totalMissing - payoutVectors.length).toLocaleString()}`);
  console.log(`    Success rate: ${Math.round(payoutVectors.length / totalMissing * 100)}%\n`);

  // Step 4: Insert payout vectors
  if (payoutVectors.length > 0) {
    console.log('4️⃣ Inserting payout vectors:\n');

    const batchSize = 1000;
    const insertBatches = Math.ceil(payoutVectors.length / batchSize);

    for (let i = 0; i < insertBatches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, payoutVectors.length);
      const batch = payoutVectors.slice(start, end);

      const rows = batch.map(pv => ({
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

      console.log(`  Batch ${i + 1}/${insertBatches} inserted (${end} total)`);
    }

    console.log(`  ✅ Inserted ${payoutVectors.length.toLocaleString()} vectors\n`);
  }

  // Step 5: Verify coverage
  console.log('5️⃣ Verifying coverage improvement:\n');

  const coverageCheck = await ch.query({
    query: `
      WITH
        all_resolutions AS (
          SELECT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        ),
        traded_markets AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        )
      SELECT
        COUNT(DISTINCT t.cid_norm) as total_traded,
        COUNT(DISTINCT CASE WHEN r.cid_norm IS NOT NULL THEN t.cid_norm END) as with_resolution,
        ROUND(with_resolution / total_traded * 100, 2) as coverage_pct
      FROM traded_markets t
      LEFT JOIN all_resolutions r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const coverageData = await coverageCheck.json<any>();

  console.log(`  Market coverage:`);
  console.log(`    Total: ${parseInt(coverageData[0].total_traded).toLocaleString()}`);
  console.log(`    Resolved: ${parseInt(coverageData[0].with_resolution).toLocaleString()}`);
  console.log(`    Coverage: ${coverageData[0].coverage_pct}%\n`);

  const positionCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved,
        ROUND(resolved / total_positions * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const posData = await positionCoverage.json<any>();
  console.log(`  Position coverage:`);
  console.log(`    Total: ${parseInt(posData[0].total_positions).toLocaleString()}`);
  console.log(`    Resolved: ${parseInt(posData[0].resolved).toLocaleString()}`);
  console.log(`    Coverage: ${posData[0].coverage_pct}%\n`);

  console.log('═'.repeat(80));
  console.log('✅ BLOCKCHAIN FETCH COMPLETE\n');

  const newCoverage = parseFloat(posData[0].coverage_pct);
  console.log(`Coverage: 11.92% → ${newCoverage}% (+${Math.round(newCoverage - 11.92)}%)\n`);

  console.log('Next steps:');
  console.log('  1. ✅ Test P&L on current data (ready now!)');
  console.log('  2. Compare top wallets to Polymarket UI');
  console.log('  3. Historical backfill for wallet 0x4ce7\n');

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
