#!/usr/bin/env tsx
/**
 * Phase 6: Batch Ghost Market Wallet Discovery
 *
 * Purpose: Discover all wallets trading ghost/zero-CLOB markets using trades_raw
 *
 * Strategy:
 * 1. Load ghost market candidates from gamma_resolved
 * 2. Process in batches of 1000 markets
 * 3. For each market, find DISTINCT wallets from trades_raw
 * 4. Insert into ghost_market_wallets_all with idempotent dedupe
 * 5. Emit progress summaries after each batch
 *
 * C2 - External Data Ingestion Agent
 */
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

const BATCH_SIZE = 1000; // Process 1000 markets at a time

interface ProgressStats {
  batch_number: number;
  markets_processed: number;
  wallets_found: number;
  new_pairs_inserted: number;
  total_markets_so_far: number;
  total_wallets_so_far: number;
  total_pairs_so_far: number;
}

async function createGlobalWalletsTable() {
  console.log('Creating ghost_market_wallets_all table...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS ghost_market_wallets_all (
        condition_id String,
        wallet String,
        source_tag String DEFAULT 'trades_raw',
        created_at DateTime DEFAULT now()
      ) ENGINE = MergeTree()
      ORDER BY (condition_id, wallet)
      PRIMARY KEY (condition_id, wallet)
    `
  });

  console.log('✅ Table created or already exists');
  console.log('');
}

async function getGhostMarketCandidates(): Promise<string[]> {
  console.log('Loading ghost market candidates...');

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT concat('0x', g.cid) as condition_id
      FROM gamma_resolved g
      LEFT JOIN (
        SELECT condition_id, COUNT(*) as clob_count
        FROM clob_fills
        GROUP BY condition_id
      ) c ON concat('0x', g.cid) = c.condition_id
      WHERE c.clob_count IS NULL OR c.clob_count = 0
      ORDER BY condition_id
    `,
    format: 'JSONEachRow'
  });

  const candidates: any[] = await result.json();
  const conditionIds = candidates.map(c => c.condition_id);

  console.log(`✅ Found ${conditionIds.length} ghost market candidates`);
  console.log('');

  return conditionIds;
}

async function discoverWalletsForBatch(
  conditionIds: string[],
  batchNumber: number
): Promise<{ condition_id: string; wallet: string }[]> {
  console.log(`Batch ${batchNumber}: Discovering wallets for ${conditionIds.length} markets...`);

  // Build condition list for SQL IN clause
  const conditionList = conditionIds.map(cid => `'${cid}'`).join(', ');

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT
        condition_id,
        wallet
      FROM trades_raw
      WHERE condition_id IN (${conditionList})
        AND wallet != ''
        AND wallet IS NOT NULL
      ORDER BY condition_id, wallet
    `,
    format: 'JSONEachRow'
  });

  const walletPairs: any[] = await result.json();

  console.log(`  Found ${walletPairs.length} wallet-market pairs`);

  return walletPairs;
}

async function insertWalletPairs(
  pairs: { condition_id: string; wallet: string }[]
): Promise<number> {
  if (pairs.length === 0) {
    return 0;
  }

  // Get count before insertion
  const beforeResult = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM ghost_market_wallets_all`,
    format: 'JSONEachRow'
  });
  const beforeCount = (await beforeResult.json())[0].cnt;

  // Transform to table format
  const rows = pairs.map(p => ({
    condition_id: p.condition_id,
    wallet: p.wallet,
    source_tag: 'trades_raw'
  }));

  // Insert (MergeTree ORDER BY will dedupe on primary key)
  await clickhouse.insert({
    table: 'ghost_market_wallets_all',
    values: rows,
    format: 'JSONEachRow'
  });

  // Get count after insertion
  const afterResult = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM ghost_market_wallets_all`,
    format: 'JSONEachRow'
  });
  const afterCount = (await afterResult.json())[0].cnt;

  const newRows = afterCount - beforeCount;

  console.log(`  Inserted ${newRows} new pairs (${pairs.length - newRows} duplicates skipped)`);

  return newRows;
}

async function getCurrentStats(): Promise<{
  total_pairs: number;
  unique_markets: number;
  unique_wallets: number;
}> {
  const result = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_pairs,
        COUNT(DISTINCT condition_id) as unique_markets,
        COUNT(DISTINCT wallet) as unique_wallets
      FROM ghost_market_wallets_all
    `,
    format: 'JSONEachRow'
  });

  return (await result.json())[0];
}

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 6: Batch Ghost Market Wallet Discovery');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Create table
  await createGlobalWalletsTable();

  // Step 2: Get all ghost market candidates
  const allCandidates = await getGhostMarketCandidates();

  if (allCandidates.length === 0) {
    console.log('⚠️  No ghost market candidates found');
    return;
  }

  // Step 3: Process in batches
  const totalBatches = Math.ceil(allCandidates.length / BATCH_SIZE);
  const progressLog: ProgressStats[] = [];

  console.log(`Processing ${allCandidates.length} markets in ${totalBatches} batches of ${BATCH_SIZE}...`);
  console.log('');

  for (let i = 0; i < totalBatches; i++) {
    const batchNumber = i + 1;
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, allCandidates.length);
    const batchCandidates = allCandidates.slice(start, end);

    console.log('─'.repeat(80));
    console.log(`Batch ${batchNumber}/${totalBatches} (markets ${start + 1}-${end})`);
    console.log('─'.repeat(80));

    // Discover wallets for this batch
    const walletPairs = await discoverWalletsForBatch(batchCandidates, batchNumber);

    // Insert into database
    const newPairsInserted = await insertWalletPairs(walletPairs);

    // Get current totals
    const stats = await getCurrentStats();

    // Log batch progress
    const progress: ProgressStats = {
      batch_number: batchNumber,
      markets_processed: batchCandidates.length,
      wallets_found: walletPairs.length,
      new_pairs_inserted: newPairsInserted,
      total_markets_so_far: stats.unique_markets,
      total_wallets_so_far: stats.unique_wallets,
      total_pairs_so_far: stats.total_pairs
    };

    progressLog.push(progress);

    console.log('');
    console.log(`Batch ${batchNumber} Summary:`);
    console.log(`  Markets in batch:     ${progress.markets_processed}`);
    console.log(`  Wallets found:        ${progress.wallets_found}`);
    console.log(`  New pairs inserted:   ${progress.new_pairs_inserted}`);
    console.log(`  Total markets so far: ${progress.total_markets_so_far}`);
    console.log(`  Total wallets so far: ${progress.total_wallets_so_far}`);
    console.log(`  Total pairs so far:   ${progress.total_pairs_so_far}`);
    console.log('');

    // Brief pause between batches to avoid overwhelming DB
    if (i < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Final summary
  console.log('═'.repeat(80));
  console.log('DISCOVERY COMPLETE');
  console.log('═'.repeat(80));
  console.log('');

  const finalStats = await getCurrentStats();
  console.log(`Total ghost markets discovered:  ${finalStats.unique_markets}`);
  console.log(`Total unique wallets:            ${finalStats.unique_wallets}`);
  console.log(`Total wallet-market pairs:       ${finalStats.total_pairs}`);
  console.log('');

  // Top 10 markets by wallet count
  console.log('Top 10 markets by wallet count:');
  const topMarketsResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        COUNT(DISTINCT wallet) as wallet_count
      FROM ghost_market_wallets_all
      GROUP BY condition_id
      ORDER BY wallet_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const topMarkets: any[] = await topMarketsResult.json();
  topMarkets.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.condition_id.substring(0, 24)}... → ${m.wallet_count} wallets`);
  });
  console.log('');

  // Create summary report
  const report = `# Global Ghost Market Wallet Discovery

**Date:** ${new Date().toISOString()}
**Agent:** C2 - External Data Ingestion
**Status:** ✅ **DISCOVERY COMPLETE**

---

## Executive Summary

**Total ghost markets discovered:** ${finalStats.unique_markets}
**Total unique wallets:** ${finalStats.unique_wallets}
**Total wallet-market pairs:** ${finalStats.total_pairs}

---

## Discovery Process

**Source:** trades_raw table
**Method:** DISTINCT wallet per condition_id
**Batch size:** ${BATCH_SIZE} markets per batch
**Total batches:** ${totalBatches}

---

## Batch Progress

${progressLog.map(p => `
### Batch ${p.batch_number}
- Markets processed: ${p.markets_processed}
- Wallets found: ${p.wallets_found}
- New pairs inserted: ${p.new_pairs_inserted}
- Total markets so far: ${p.total_markets_so_far}
- Total wallets so far: ${p.total_wallets_so_far}
- Total pairs so far: ${p.total_pairs_so_far}
`).join('\n')}

---

## Top 10 Markets by Wallet Count

${topMarkets.map((m, i) => `${i + 1}. \`${m.condition_id}\` → ${m.wallet_count} wallets`).join('\n')}

---

## Database Table

**Table:** \`ghost_market_wallets_all\`
**Schema:**
- \`condition_id\` String
- \`wallet\` String
- \`source_tag\` String (default: 'trades_raw')
- \`created_at\` DateTime

**Primary Key:** (condition_id, wallet)
**Deduplication:** Automatic via MergeTree ORDER BY

---

## Next Steps

**Phase 7:** Generalized external ingestion for all discovered wallets
- Extend Data-API connector to read from \`ghost_market_wallets_all\`
- Process in batches with crash protection
- Insert into \`external_trades_raw\`

---

**— C2 (External Data Ingestion Agent)**

_Global wallet discovery complete. ${finalStats.total_pairs} wallet-market pairs ready for Data-API ingestion._
`;

  writeFileSync('C2_GHOST_MARKET_WALLET_DISCOVERY_GLOBAL.md', report);
  console.log('✅ Report saved to: C2_GHOST_MARKET_WALLET_DISCOVERY_GLOBAL.md');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Discovery failed:', error);
  process.exit(1);
});
