/**
 * Build pm_wallet_solvability_v1 table
 *
 * This table classifies wallets into solvable vs unsolvable categories
 * based on three hard exclusion rules:
 *
 * 1. has_negrisk: Wallet has NegRisk conversions (unsolvable)
 * 2. has_direct_ctf: Wallet has direct CTF activity (separate cohort)
 * 3. has_inventory_violation: Wallet sells more than it bought (external inventory)
 *
 * Solvable wallets are those where we can accurately compute PnL
 * from CLOB data alone.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_NAME = 'pm_wallet_solvability_v1';

async function createTable() {
  console.log('Creating table:', TABLE_NAME);

  const createQuery = `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME}
    (
      wallet String,

      -- Hard exclusion flags
      has_negrisk UInt8,           -- 1 if wallet has NegRisk conversions
      has_direct_ctf UInt8,        -- 1 if wallet has direct CTF activity
      has_inventory_violation UInt8, -- 1 if sells > buys for any position

      -- Counts for diagnostics
      clob_trades UInt64,
      direct_ctf_splits UInt64,
      direct_ctf_merges UInt64,
      direct_ctf_redemptions UInt64,
      negrisk_conversions UInt64,
      inventory_violations UInt64,  -- Count of positions with sells > buys

      -- Classification
      local_class String,          -- CLOB_ONLY, CLOB_PLUS_DIRECT_CTF, NEGRISK, EXTERNAL_INVENTORY
      is_locally_solvable UInt8,   -- 1 if we can compute PnL locally

      -- Metadata
      computed_at DateTime DEFAULT now(),

      -- For deduplication
      is_deleted UInt8 DEFAULT 0
    )
    ENGINE = ReplacingMergeTree(computed_at)
    ORDER BY wallet
  `;

  await clickhouse.command({ query: createQuery });
  console.log('Table created');
}

async function computeSolvability() {
  console.log('Computing wallet solvability...');

  // Process in stages to avoid timeout
  // Stage 1: Get all unique wallets with CLOB counts
  console.log('Stage 1: Getting unique wallets and CLOB counts...');
  const walletsQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      count() as clob_trades
    FROM pm_trader_events_v3
    GROUP BY lower(trader_wallet)
  `;
  const walletsResult = await clickhouse.query({ query: walletsQuery, format: 'JSONEachRow' });
  const wallets = await walletsResult.json() as any[];
  console.log(`Found ${wallets.length} unique wallets`);

  // Stage 2: Get NegRisk counts
  console.log('Stage 2: Getting NegRisk conversion counts...');
  const nrQuery = `
    SELECT
      lower(user_address) as wallet,
      count() as negrisk_conversions
    FROM pm_neg_risk_conversions_v1
    WHERE is_deleted = 0
    GROUP BY lower(user_address)
  `;
  const nrResult = await clickhouse.query({ query: nrQuery, format: 'JSONEachRow' });
  const nrRows = await nrResult.json() as any[];
  const nrMap = new Map(nrRows.map((r: any) => [r.wallet, r.negrisk_conversions]));
  console.log(`Found ${nrRows.length} wallets with NegRisk conversions`);

  // Stage 3: Get direct CTF activity
  console.log('Stage 3: Getting direct CTF activity...');
  const ctfQuery = `
    SELECT
      lower(user_address) as wallet,
      countIf(event_type = 'PositionSplit') as direct_splits,
      countIf(event_type = 'PositionsMerge') as direct_merges,
      countIf(event_type = 'PayoutRedemption') as direct_redemptions
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
    GROUP BY lower(user_address)
  `;
  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = await ctfResult.json() as any[];
  const ctfMap = new Map(ctfRows.map((r: any) => [r.wallet, r]));
  console.log(`Found ${ctfRows.length} wallets with direct CTF activity`);

  // Stage 4: Get inventory violations (skip for now - very expensive)
  // Instead, we'll compute this for a subset later or use a materialized view
  console.log('Stage 4: Skipping inventory violations (will compute separately)...');
  const ivMap = new Map<string, number>();
  console.log('Inventory violations: deferred');

  // Stage 5: Combine and classify
  console.log('Stage 5: Combining and classifying...');
  const rows: any[] = [];

  for (const w of wallets) {
    const wallet = w.wallet;
    const nrConversions = nrMap.get(wallet) || 0;
    const ctf = ctfMap.get(wallet) || { direct_splits: 0, direct_merges: 0, direct_redemptions: 0 };
    const ivCount = ivMap.get(wallet) || 0;

    const hasNegrisk = nrConversions > 0 ? 1 : 0;
    const hasDirectCtf = (ctf.direct_splits + ctf.direct_merges + ctf.direct_redemptions) > 0 ? 1 : 0;
    const hasInventoryViolation = ivCount > 0 ? 1 : 0;

    let localClass: string;
    if (nrConversions > 0) {
      localClass = 'NEGRISK';
    } else if (ctf.direct_splits + ctf.direct_merges > 0) {
      // Note: only splits/merges excluded, redemptions are handled by V1
      localClass = 'CLOB_PLUS_DIRECT_CTF';
    } else {
      localClass = 'CLOB_ONLY';
    }
    // Note: inventory violations deferred to later pass

    const isLocallySolvable = localClass === 'CLOB_ONLY' ? 1 : 0;

    rows.push({
      wallet,
      has_negrisk: hasNegrisk,
      has_direct_ctf: hasDirectCtf,
      has_inventory_violation: hasInventoryViolation,
      clob_trades: w.clob_trades,
      direct_ctf_splits: ctf.direct_splits || 0,
      direct_ctf_merges: ctf.direct_merges || 0,
      direct_ctf_redemptions: ctf.direct_redemptions || 0,
      negrisk_conversions: nrConversions,
      inventory_violations: ivCount,
      local_class: localClass,
      is_locally_solvable: isLocallySolvable,
    });
  }

  console.log(`Classified ${rows.length} wallets`);

  // Insert in batches
  const batchSize = 10000;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await clickhouse.insert({
      table: TABLE_NAME,
      values: batch,
      format: 'JSONEachRow',
    });

    console.log(`Inserted ${Math.min(i + batchSize, rows.length)}/${rows.length} rows`);
  }

  return rows.length;
}

async function printSummary() {
  console.log('\n=== Solvability Summary ===\n');

  const summaryQuery = `
    SELECT
      local_class,
      is_locally_solvable,
      count() as wallet_count,
      sum(clob_trades) as total_trades
    FROM ${TABLE_NAME}
    WHERE is_deleted = 0
    GROUP BY local_class, is_locally_solvable
    ORDER BY wallet_count DESC
  `;

  const result = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  console.log('By Classification:');
  for (const row of rows) {
    console.log(`  ${row.local_class}: ${row.wallet_count} wallets, ${row.total_trades} trades, solvable=${row.is_locally_solvable}`);
  }

  // Get solvable counts
  const solvableQuery = `
    SELECT
      is_locally_solvable,
      count() as wallet_count,
      sum(clob_trades) as total_trades
    FROM ${TABLE_NAME}
    WHERE is_deleted = 0
    GROUP BY is_locally_solvable
  `;

  const solvableResult = await clickhouse.query({ query: solvableQuery, format: 'JSONEachRow' });
  const solvableRows = await solvableResult.json() as any[];

  console.log('\nSolvability:');
  for (const row of solvableRows) {
    const label = row.is_locally_solvable ? 'SOLVABLE' : 'NOT SOLVABLE';
    console.log(`  ${label}: ${row.wallet_count} wallets, ${row.total_trades} trades`);
  }
}

async function main() {
  try {
    await createTable();

    // Truncate any existing data
    console.log('Truncating existing data...');
    await clickhouse.command({ query: `TRUNCATE TABLE IF EXISTS ${TABLE_NAME}` });

    const count = await computeSolvability();
    await printSummary();
    console.log(`\nDone! Classified ${count} wallets.`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
