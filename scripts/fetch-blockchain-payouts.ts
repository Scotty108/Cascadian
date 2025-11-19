#!/usr/bin/env tsx
/**
 * Blockchain Payout Fetcher
 *
 * Fetches payout vectors directly from Polygon CTF contract PayoutRedemption events
 * for the 4,380 markets missing from api_markets_staging
 *
 * Contract: 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045
 * Event: PayoutRedemption(bytes32 indexed conditionId, address indexed redeemer, uint256[] payouts)
 *
 * Runtime: ~30-45 minutes
 * Expected: +4,380 markets (59% → 61-62% coverage)
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { polygon } from 'viem/chains';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// Initialize Polygon client
const polygonClient = createPublicClient({
  chain: polygon,
  transport: http(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'),
});

interface PayoutVector {
  condition_id: string;
  payout_numerators: number[];
  payout_denominator: number;
  winning_index: number;
  resolved_at: Date;
  source: string;
  fetched_at: Date;
}

async function getMissingConditionIds(): Promise<string[]> {
  console.log('📊 Getting list of missing condition_ids...');

  const result = await ch.query({
    query: `
      SELECT DISTINCT rc.condition_id_norm
      FROM default.resolution_candidates rc
      WHERE rc.confidence >= 0.9
        AND rc.outcome != 'INVALID'
        AND rc.condition_id_norm NOT IN (
          SELECT lower(replaceAll(condition_id, '0x', ''))
          FROM default.api_markets_staging
          WHERE length(outcomes) > 0
        )
        AND rc.condition_id_norm IN (
          SELECT DISTINCT lower(replaceAll(cid, '0x', ''))
          FROM default.fact_trades_clean
        )
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json();
  const conditionIds = rows.map((r: any) => '0x' + r.condition_id_norm);

  console.log(`  ✅ Found ${conditionIds.length} missing condition_ids\n`);
  return conditionIds;
}

async function fetchPayoutForCondition(conditionId: string): Promise<PayoutVector | null> {
  try {
    // Fetch PayoutRedemption events for this condition
    const logs = await polygonClient.getLogs({
      address: CTF_CONTRACT as `0x${string}`,
      event: parseAbiItem('event PayoutRedemption(bytes32 indexed conditionId, address indexed redeemer, uint256[] payouts)'),
      args: {
        conditionId: conditionId as `0x${string}`,
      },
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    if (logs.length === 0) {
      return null;
    }

    // Take the first redemption event (they should all have same payout vector)
    const log = logs[0];
    const args = log.args as { conditionId: string; redeemer: string; payouts: bigint[] };

    // Convert BigInt array to number array and normalize
    const payoutNumerators = args.payouts.map(p => Number(p));
    const payoutDenominator = payoutNumerators.reduce((sum, p) => sum + p, 0);

    // Find winning index (highest payout)
    const maxPayout = Math.max(...payoutNumerators);
    const winningIndex = payoutNumerators.findIndex(p => p === maxPayout);

    // Normalize condition_id (remove 0x prefix, lowercase)
    const normalizedCid = conditionId.toLowerCase().replace('0x', '');

    return {
      condition_id: normalizedCid,
      payout_numerators: payoutNumerators,
      payout_denominator: payoutDenominator,
      winning_index: winningIndex,
      resolved_at: new Date(),
      source: 'blockchain_ctf_payout_redemption',
      fetched_at: new Date(),
    };
  } catch (error) {
    console.error(`  ❌ Error fetching payout for ${conditionId}:`, error);
    return null;
  }
}

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔗 BLOCKCHAIN PAYOUT FETCHER');
  console.log('   Fetching payout vectors from Polygon CTF contract');
  console.log('   Contract: 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045');
  console.log('═'.repeat(80));

  // Step 1: Get missing condition_ids
  const missingIds = await getMissingConditionIds();

  if (missingIds.length === 0) {
    console.log('\n  ✅ No missing condition_ids found!');
    await ch.close();
    return;
  }

  console.log(`📊 Fetching payout vectors for ${missingIds.length} condition_ids...`);
  console.log(`   Estimated runtime: ${Math.ceil(missingIds.length * 0.5 / 60)} minutes\n`);

  // Step 2: Fetch payouts from blockchain
  const payoutVectors: PayoutVector[] = [];
  const stats = {
    total: missingIds.length,
    found: 0,
    notFound: 0,
    errors: 0,
  };

  for (let i = 0; i < missingIds.length; i++) {
    const conditionId = missingIds[i];

    const payout = await fetchPayoutForCondition(conditionId);

    if (payout) {
      payoutVectors.push(payout);
      stats.found++;
    } else {
      stats.notFound++;
    }

    // Progress update every 100
    if ((i + 1) % 100 === 0) {
      const pct = ((i + 1) / stats.total * 100).toFixed(1);
      console.log(`  Progress: ${i + 1}/${stats.total} (${pct}%) | Found: ${stats.found} | Not found: ${stats.notFound}`);
    }

    // Rate limiting - 10 requests per second max
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n  ✅ Fetch complete!');
  console.log(`\n  Statistics:`);
  console.log(`    Total condition_ids: ${stats.total}`);
  console.log(`    Payout vectors found: ${stats.found} ✅`);
  console.log(`    Not found on-chain: ${stats.notFound}`);
  console.log(`    Success rate: ${(stats.found / stats.total * 100).toFixed(1)}%`);

  // Step 3: Insert into DB
  if (payoutVectors.length === 0) {
    console.log('\n  ⚠️  No payout vectors to insert');
    await ch.close();
    return;
  }

  console.log(`\n📊 Inserting ${payoutVectors.length} payout vectors into resolutions_external_ingest...`);

  const batchSize = 1000;
  let inserted = 0;

  for (let i = 0; i < payoutVectors.length; i += batchSize) {
    const batch = payoutVectors.slice(i, i + batchSize);

    await ch.insert({
      table: 'default.resolutions_external_ingest',
      values: batch,
      format: 'JSONEachRow',
    });

    inserted += batch.length;
    console.log(`  Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(payoutVectors.length / batchSize)} (${inserted} total)`);
  }

  console.log(`  ✅ Inserted ${inserted} payout vectors`);

  // Step 4: Verify coverage
  console.log('\n📊 Verifying coverage improvement...');

  const beforeCoverage = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      )
      SELECT
        COUNT(*) as total_traded,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout_before
      FROM traded_markets tm
      LEFT JOIN default.market_resolutions_final r
        ON tm.condition_id = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const afterCoverage = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator
        FROM default.resolutions_external_ingest
      )
      SELECT
        COUNT(*) as total_traded,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout_after
      FROM traded_markets tm
      LEFT JOIN all_resolutions r
        ON tm.condition_id = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const beforeStats = await beforeCoverage.json();
  const afterStats = await afterCoverage.json();

  const totalTraded = parseInt(beforeStats[0].total_traded);
  const beforePayout = parseInt(beforeStats[0].has_payout_before);
  const afterPayout = parseInt(afterStats[0].has_payout_after);

  const beforePct = (beforePayout / totalTraded) * 100;
  const afterPct = (afterPayout / totalTraded) * 100;
  const improvement = afterPayout - beforePayout;

  console.log('\n  📈 Coverage Improvement:');
  console.log(`    Total traded markets: ${totalTraded.toLocaleString()}`);
  console.log(`    Before: ${beforePayout.toLocaleString()} markets (${beforePct.toFixed(1)}%)`);
  console.log(`    After:  ${afterPayout.toLocaleString()} markets (${afterPct.toFixed(1)}%)`);
  console.log(`    Improvement: +${improvement.toLocaleString()} markets (+${(afterPct - beforePct).toFixed(1)}%)`);

  console.log('\n' + '═'.repeat(80));
  console.log('✅ BLOCKCHAIN PAYOUT FETCH COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
