#!/usr/bin/env npx tsx
/**
 * Fetch Blockchain Payouts for Missing Markets
 *
 * Fetches payout vectors from CTF contract PayoutRedemption events
 * for the 4,380 markets that don't exist in api_markets_staging
 *
 * Runtime: ~30-45 minutes
 * Expected: Push coverage to ~61-62%
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
  console.log('\n⛓️  FETCHING BLOCKCHAIN PAYOUTS FOR MISSING MARKETS\n');
  console.log('═'.repeat(80));

  // Step 1: Get list of missing condition_ids
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
    console.log('✅ No missing markets - all resolved!\n');
    await ch.close();
    return;
  }

  // Step 2: Set up blockchain connection
  console.log('2️⃣ Connecting to Polygon blockchain:\n');

  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);

  try {
    const network = await provider.getNetwork();
    console.log(`  ✅ Connected to Polygon (chainId: ${network.chainId})\n`);
  } catch (e: any) {
    console.error(`  ❌ Failed to connect: ${e.message}\n`);
    await ch.close();
    return;
  }

  // Step 3: Fetch events in batches
  console.log('3️⃣ Fetching ConditionResolution events:\n');
  console.log('  This will take ~30-45 minutes for 4,380 markets...\n');

  const payoutVectors: PayoutVector[] = [];
  const batchSize = 100; // Process 100 condition_ids at a time
  const batches = Math.ceil(totalMissing / batchSize);

  let found = 0;
  let notFound = 0;

  for (let i = 0; i < batches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, totalMissing);
    const batch = missingData.slice(start, end);

    console.log(`  Batch ${i + 1}/${batches}: Processing ${batch.length} condition_ids...`);

    for (const row of batch) {
      const conditionId = '0x' + row.condition_id;

      try {
        // Query for ConditionResolution event for this specific condition_id
        // We need to search a wide block range (CTF deployed ~block 15M, current ~52M)
        const fromBlock = 15000000; // CTF contract deployment
        const toBlock = 'latest';

        const filter = {
          address: CTF_ADDRESS,
          topics: [
            EVENT_TOPIC,
            conditionId // First indexed parameter
          ],
          fromBlock,
          toBlock
        };

        const logs = await provider.getLogs(filter);

        if (logs.length > 0) {
          // Parse the event
          const log = logs[0]; // Take first (should only be one)

          // Decode event data
          // Event: ConditionResolution(bytes32 indexed conditionId, address indexed oracle, uint256 questionId, uint256[] payoutNumerators)
          const iface = new ethers.Interface([
            'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, uint256 questionId, uint256[] payoutNumerators)'
          ]);

          const decoded = iface.parseLog({
            topics: log.topics,
            data: log.data
          });

          if (decoded) {
            const payoutNumerators = decoded.args.payoutNumerators.map((n: bigint) => Number(n));
            const payoutDenominator = payoutNumerators.reduce((a: number, b: number) => a + b, 0);

            // Get block timestamp
            const block = await provider.getBlock(log.blockNumber);

            payoutVectors.push({
              condition_id: row.condition_id, // Store without 0x
              payout_numerators: payoutNumerators,
              payout_denominator: payoutDenominator,
              block_number: log.blockNumber,
              block_timestamp: new Date((block?.timestamp || 0) * 1000),
              tx_hash: log.transactionHash
            });

            found++;
          }
        } else {
          notFound++;
        }

      } catch (e: any) {
        console.error(`    ⚠️  Error fetching ${conditionId.substring(0, 18)}...: ${e.message}`);
        notFound++;
      }

      // Rate limiting - don't hammer the RPC
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`    Found: ${found}, Not found: ${notFound}`);
  }

  console.log(`\n  ✅ Fetch complete!\n`);
  console.log(`  Statistics:`);
  console.log(`    Total queried: ${totalMissing.toLocaleString()}`);
  console.log(`    Found on-chain: ${found.toLocaleString()}`);
  console.log(`    Not found: ${notFound.toLocaleString()}`);
  console.log(`    Success rate: ${Math.round(found / totalMissing * 100)}%\n`);

  // Step 4: Insert payout vectors into resolutions_external_ingest
  if (payoutVectors.length > 0) {
    console.log('4️⃣ Inserting payout vectors into resolutions_external_ingest:\n');

    const batchInsertSize = 1000;
    const insertBatches = Math.ceil(payoutVectors.length / batchInsertSize);

    for (let i = 0; i < insertBatches; i++) {
      const start = i * batchInsertSize;
      const end = Math.min(start + batchInsertSize, payoutVectors.length);
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

      console.log(`  Inserted batch ${i + 1}/${insertBatches} (${end} total)`);
    }

    console.log(`  ✅ Inserted ${payoutVectors.length.toLocaleString()} payout vectors\n`);
  } else {
    console.log('4️⃣ No payout vectors to insert\n');
  }

  // Step 5: Verify coverage improvement
  console.log('5️⃣ Checking coverage improvement:\n');

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

  console.log(`  Market-level coverage:`);
  console.log(`    Total traded markets: ${parseInt(coverageData[0].total_traded).toLocaleString()}`);
  console.log(`    With resolution: ${parseInt(coverageData[0].with_resolution).toLocaleString()}`);
  console.log(`    Coverage: ${coverageData[0].coverage_pct}%\n`);

  // Check position coverage
  const positionCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved_positions,
        ROUND(resolved_positions / total_positions * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const posData = await positionCoverage.json<any>();
  console.log(`  Position-level coverage:`);
  console.log(`    Total positions: ${parseInt(posData[0].total_positions).toLocaleString()}`);
  console.log(`    Resolved: ${parseInt(posData[0].resolved_positions).toLocaleString()}`);
  console.log(`    Coverage: ${posData[0].coverage_pct}%\n`);

  console.log('═'.repeat(80));
  console.log('✅ BLOCKCHAIN PAYOUT FETCH COMPLETE\n');

  const newCoverage = parseFloat(posData[0].coverage_pct);
  const expectedCoverage = 61.0;

  if (newCoverage >= expectedCoverage) {
    console.log('🎉 SUCCESS! Coverage reached target');
    console.log(`   Before: 11.92%`);
    console.log(`   After: ${newCoverage}%`);
    console.log(`   Improvement: +${Math.round(newCoverage - 11.92)}%\n`);
  } else if (newCoverage > 15) {
    console.log('✅ Good progress');
    console.log(`   Before: 11.92%`);
    console.log(`   After: ${newCoverage}%`);
    console.log(`   Still below ${expectedCoverage}% target\n`);
  } else {
    console.log('⚠️  Limited improvement');
    console.log(`   Most markets may not have on-chain resolution events\n`);
  }

  console.log('Next steps:');
  console.log('  1. Test P&L calculations on current June-Nov 2024 data');
  console.log('  2. Compare top wallets to Polymarket UI');
  console.log('  3. Historical backfill for wallet 0x4ce7 (2,800 trades)\n');

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
