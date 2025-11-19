#!/usr/bin/env tsx

/**
 * Backfill Payout Vectors from Polymarket PNL Subgraph
 *
 * This script:
 * 1. Queries all unique condition_ids from our trades table
 * 2. Batch fetches payout vectors from Polymarket's PNL Subgraph
 * 3. Inserts them into ClickHouse for P&L calculation
 *
 * Runtime: ~2-3 hours for full backfill
 */

import { createClient } from '@clickhouse/client';

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
const PNL_SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn';

const BATCH_SIZE = 1000; // GraphQL supports up to 1000 per query
const CONCURRENT_REQUESTS = 5; // Parallel GraphQL queries

interface Condition {
  id: string;
  payoutNumerators: string[];
  payoutDenominator: string;
  positionIds?: string[];
}

interface PayoutVector {
  condition_id: string;
  payout_numerators: number[];
  payout_denominator: number;
  position_ids: string[];
  resolved_at: string;
}

// ============================================================================
// GraphQL Query Functions
// ============================================================================

async function fetchPayoutVectors(conditionIds: string[]): Promise<Condition[]> {
  const query = `
    query GetPayouts($ids: [ID!]!) {
      conditions(where: {id_in: $ids}) {
        id
        payoutNumerators
        payoutDenominator
        positionIds
      }
    }
  `;

  try {
    const response = await fetch(PNL_SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { ids: conditionIds }
      })
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      throw new Error('GraphQL query failed');
    }

    return data.data.conditions || [];
  } catch (error) {
    console.error('Error fetching payout vectors:', error);
    throw error;
  }
}

async function fetchAllResolvedConditions(limit = 1000, skip = 0): Promise<Condition[]> {
  const query = `
    query GetResolvedConditions($limit: Int!, $skip: Int!) {
      conditions(
        first: $limit,
        skip: $skip,
        where: {payoutDenominator_gt: "0"}
      ) {
        id
        payoutNumerators
        payoutDenominator
        positionIds
      }
    }
  `;

  const response = await fetch(PNL_SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { limit, skip }
    })
  });

  const data = await response.json();
  return data.data.conditions || [];
}

// ============================================================================
// ClickHouse Functions
// ============================================================================

async function createPayoutVectorsTable(client: any) {
  console.log('Creating payout_vectors table...');

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS polymarket.payout_vectors (
        condition_id String,
        payout_numerators Array(UInt64),
        payout_denominator UInt64,
        position_ids Array(String),
        resolved_at DateTime DEFAULT now(),
        _version UInt64 DEFAULT 1
      ) ENGINE = ReplacingMergeTree(_version)
      ORDER BY condition_id
    `
  });

  console.log('Table created successfully');
}

async function getUniqueConditionIds(client: any): Promise<string[]> {
  console.log('Fetching unique condition_ids from trades...');

  const result = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM polymarket.trades
      WHERE condition_id != ''
        AND condition_id IS NOT NULL
      ORDER BY condition_id
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json();
  const conditionIds = rows.map((row: any) => row.condition_id);

  console.log(`Found ${conditionIds.length} unique condition_ids`);
  return conditionIds;
}

async function getExistingPayoutVectors(client: any): Promise<Set<string>> {
  console.log('Checking for existing payout vectors...');

  try {
    const result = await client.query({
      query: `
        SELECT condition_id
        FROM polymarket.payout_vectors
        WHERE payout_denominator > 0
      `,
      format: 'JSONEachRow'
    });

    const rows = await result.json();
    const existing = new Set(rows.map((row: any) => row.condition_id));

    console.log(`Found ${existing.size} existing payout vectors`);
    return existing;
  } catch (error) {
    console.log('No existing payout vectors (table may be empty)');
    return new Set();
  }
}

async function insertPayoutVectors(client: any, payouts: PayoutVector[]) {
  if (payouts.length === 0) {
    return;
  }

  await client.insert({
    table: 'polymarket.payout_vectors',
    values: payouts,
    format: 'JSONEachRow'
  });
}

// ============================================================================
// Main Backfill Logic
// ============================================================================

async function backfillPayoutVectors() {
  console.log('='.repeat(80));
  console.log('Polymarket Payout Vectors Backfill');
  console.log('='.repeat(80));
  console.log();

  const client = createClient({
    host: CLICKHOUSE_HOST,
    database: 'polymarket'
  });

  try {
    // Step 1: Create table if needed
    await createPayoutVectorsTable(client);

    // Step 2: Get all condition_ids from our trades
    const allConditionIds = await getUniqueConditionIds(client);

    if (allConditionIds.length === 0) {
      console.log('No condition_ids found in trades table. Nothing to backfill.');
      return;
    }

    // Step 3: Check what we already have
    const existingPayouts = await getExistingPayoutVectors(client);
    const missingConditionIds = allConditionIds.filter(id => !existingPayouts.has(id));

    console.log(`\nBackfill Summary:`);
    console.log(`  Total conditions: ${allConditionIds.length}`);
    console.log(`  Already have: ${existingPayouts.size}`);
    console.log(`  Need to fetch: ${missingConditionIds.length}`);
    console.log();

    if (missingConditionIds.length === 0) {
      console.log('All payout vectors already backfilled!');
      return;
    }

    // Step 4: Batch fetch payout vectors
    let totalFetched = 0;
    let totalInserted = 0;
    const totalBatches = Math.ceil(missingConditionIds.length / BATCH_SIZE);

    for (let i = 0; i < missingConditionIds.length; i += BATCH_SIZE * CONCURRENT_REQUESTS) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`\nBatch ${batchNum}/${totalBatches}:`);

      // Create concurrent requests for multiple batches
      const promises: Promise<Condition[]>[] = [];
      for (let j = 0; j < CONCURRENT_REQUESTS; j++) {
        const start = i + (j * BATCH_SIZE);
        const end = start + BATCH_SIZE;
        if (start >= missingConditionIds.length) break;

        const batch = missingConditionIds.slice(start, end);
        promises.push(fetchPayoutVectors(batch));
      }

      // Wait for all concurrent requests
      const results = await Promise.all(promises);
      const allConditions = results.flat();

      totalFetched += allConditions.length;
      console.log(`  Fetched: ${allConditions.length} payout vectors`);

      // Filter only resolved conditions (with payout data)
      const resolvedConditions = allConditions.filter(
        c => c.payoutDenominator && c.payoutDenominator !== '0'
      );

      if (resolvedConditions.length > 0) {
        // Transform to our schema
        const payouts: PayoutVector[] = resolvedConditions.map(c => ({
          condition_id: c.id,
          payout_numerators: c.payoutNumerators.map(n => parseInt(n, 10)),
          payout_denominator: parseInt(c.payoutDenominator, 10),
          position_ids: c.positionIds || [],
          resolved_at: new Date().toISOString()
        }));

        // Insert into ClickHouse
        await insertPayoutVectors(client, payouts);
        totalInserted += payouts.length;

        console.log(`  Inserted: ${payouts.length} resolved conditions`);
        console.log(`  Unresolved: ${allConditions.length - resolvedConditions.length}`);
      } else {
        console.log(`  No resolved conditions in this batch`);
      }

      // Progress indicator
      const progress = ((i + BATCH_SIZE * CONCURRENT_REQUESTS) / missingConditionIds.length * 100).toFixed(1);
      console.log(`  Progress: ${progress}%`);
    }

    console.log();
    console.log('='.repeat(80));
    console.log('Backfill Complete!');
    console.log('='.repeat(80));
    console.log(`Total fetched: ${totalFetched}`);
    console.log(`Total inserted: ${totalInserted}`);
    console.log(`Unresolved: ${totalFetched - totalInserted}`);
    console.log();

    // Step 5: Verify results
    const finalCount = await client.query({
      query: 'SELECT count() as count FROM polymarket.payout_vectors',
      format: 'JSONEachRow'
    });

    const finalResult = await finalCount.json();
    console.log(`Final payout_vectors count: ${finalResult[0].count}`);

    // Sample some results
    console.log('\nSample payout vectors:');
    const sample = await client.query({
      query: `
        SELECT
          condition_id,
          payout_numerators,
          payout_denominator,
          resolved_at
        FROM polymarket.payout_vectors
        ORDER BY resolved_at DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const sampleResults = await sample.json();
    console.table(sampleResults);

  } catch (error) {
    console.error('Backfill failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// ============================================================================
// Alternative: Fetch ALL resolved conditions from subgraph
// ============================================================================

async function backfillFromSubgraphDirectly() {
  console.log('Fetching ALL resolved conditions directly from subgraph...');

  const client = createClient({
    host: CLICKHOUSE_HOST,
    database: 'polymarket'
  });

  try {
    await createPayoutVectorsTable(client);

    let allConditions: Condition[] = [];
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching batch at offset ${skip}...`);
      const batch = await fetchAllResolvedConditions(1000, skip);

      if (batch.length === 0) {
        hasMore = false;
      } else {
        allConditions = allConditions.concat(batch);
        skip += 1000;
        console.log(`  Fetched ${batch.length} conditions (total: ${allConditions.length})`);
      }
    }

    console.log(`\nTotal resolved conditions in subgraph: ${allConditions.length}`);

    // Insert in batches
    const insertBatchSize = 10000;
    for (let i = 0; i < allConditions.length; i += insertBatchSize) {
      const batch = allConditions.slice(i, i + insertBatchSize);
      const payouts: PayoutVector[] = batch.map(c => ({
        condition_id: c.id,
        payout_numerators: c.payoutNumerators.map(n => parseInt(n, 10)),
        payout_denominator: parseInt(c.payoutDenominator, 10),
        position_ids: c.positionIds || [],
        resolved_at: new Date().toISOString()
      }));

      await insertPayoutVectors(client, payouts);
      console.log(`Inserted batch ${i / insertBatchSize + 1}`);
    }

    console.log('Complete!');
  } finally {
    await client.close();
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const mode = process.argv[2];

  if (mode === 'from-trades') {
    // Default: Only fetch payout vectors for conditions in our trades table
    await backfillPayoutVectors();
  } else if (mode === 'all-resolved') {
    // Alternative: Fetch ALL resolved conditions from subgraph
    await backfillFromSubgraphDirectly();
  } else {
    console.log('Usage:');
    console.log('  npm run backfill-payouts from-trades    # Fetch for our existing trades');
    console.log('  npm run backfill-payouts all-resolved   # Fetch ALL resolved conditions');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
