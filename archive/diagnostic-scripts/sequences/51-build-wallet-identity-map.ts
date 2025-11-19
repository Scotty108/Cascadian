/**
 * 51: BUILD WALLET IDENTITY MAP
 *
 * Track B - Step B2.1
 *
 * Creates wallet_identity_map table by aggregating clob_fills data.
 * Establishes canonical wallet identity for each (user_eoa, proxy_wallet) pair.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('51: BUILD WALLET IDENTITY MAP');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Build wallet_identity_map table from clob_fills\n');

  // Step 1: Create wallet_identity_map table
  console.log('📊 Step 1: Creating wallet_identity_map table...\n');

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS wallet_identity_map
    (
      user_eoa String,
      proxy_wallet String,
      canonical_wallet String,
      fills_count UInt64,
      markets_traded UInt64,
      first_fill_ts DateTime64(3),
      last_fill_ts DateTime64(3)
    )
    ENGINE = ReplacingMergeTree()
    ORDER BY (canonical_wallet, user_eoa, proxy_wallet)
  `;

  await clickhouse.command({
    query: createTableSQL
  });

  console.log('✅ Table created\n');

  // Step 2: Populate table by aggregating clob_fills
  console.log('📊 Step 2: Aggregating clob_fills data...\n');

  const populateSQL = `
    INSERT INTO wallet_identity_map
    SELECT
      user_eoa,
      proxy_wallet,
      -- Set canonical_wallet: prefer proxy_wallet when available
      if(
        notEmpty(proxy_wallet) AND proxy_wallet IS NOT NULL,
        proxy_wallet,
        user_eoa
      ) AS canonical_wallet,
      count(*) AS fills_count,
      countDistinct(asset_id) AS markets_traded,
      min(timestamp) AS first_fill_ts,
      max(timestamp) AS last_fill_ts
    FROM clob_fills
    GROUP BY user_eoa, proxy_wallet
  `;

  await clickhouse.command({
    query: populateSQL
  });

  console.log('✅ Data populated\n');

  // Step 3: Get count of distinct canonical wallets
  console.log('📊 Step 3: Counting distinct canonical wallets...\n');

  const countQuery = await clickhouse.query({
    query: `
      SELECT countDistinct(canonical_wallet) AS distinct_canonical_wallets
      FROM wallet_identity_map
    `,
    format: 'JSONEachRow'
  });

  const countResult: any[] = await countQuery.json();
  const distinctCount = countResult[0].distinct_canonical_wallets;

  console.log(`Total distinct canonical wallets: ${distinctCount}\n`);

  // Step 4: Get total rows
  const totalRowsQuery = await clickhouse.query({
    query: `SELECT count(*) AS total_rows FROM wallet_identity_map`,
    format: 'JSONEachRow'
  });

  const totalRowsResult: any[] = await totalRowsQuery.json();
  const totalRows = totalRowsResult[0].total_rows;

  console.log(`Total (user_eoa, proxy_wallet) pairs: ${totalRows}\n`);

  // Step 5: Show top 50 wallets by fills_count
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TOP 50 CANONICAL WALLETS BY FILLS COUNT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const top50Query = await clickhouse.query({
    query: `
      SELECT
        canonical_wallet,
        sum(fills_count) AS total_fills,
        sum(markets_traded) AS total_markets,
        min(first_fill_ts) AS earliest_fill,
        max(last_fill_ts) AS latest_fill,
        count(*) AS eoa_proxy_pairs
      FROM wallet_identity_map
      GROUP BY canonical_wallet
      ORDER BY total_fills DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const top50: any[] = await top50Query.json();

  console.log('| Rank | Canonical Wallet | Fills | Markets | EOA-Proxy Pairs | Earliest Fill | Latest Fill |');
  console.log('|------|------------------|-------|---------|-----------------|---------------|-------------|');

  top50.forEach((row, idx) => {
    const rank = idx + 1;
    const wallet = row.canonical_wallet;
    const fills = row.total_fills;
    const markets = row.total_markets;
    const pairs = row.eoa_proxy_pairs;
    const earliest = row.earliest_fill.substring(0, 10);
    const latest = row.latest_fill.substring(0, 10);

    console.log(`| ${rank} | ${wallet.substring(0, 12)}... | ${fills} | ${markets} | ${pairs} | ${earliest} | ${latest} |`);
  });

  // Step 6: Show sample of 10-20 individual rows (raw pairs)
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('SAMPLE ROWS (Individual EOA-Proxy Pairs)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        user_eoa,
        proxy_wallet,
        canonical_wallet,
        fills_count,
        markets_traded,
        first_fill_ts,
        last_fill_ts
      FROM wallet_identity_map
      ORDER BY fills_count DESC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });

  const sample: any[] = await sampleQuery.json();

  console.log('| User EOA | Proxy Wallet | Canonical | Fills | Markets | First Fill | Last Fill |');
  console.log('|----------|--------------|-----------|-------|---------|------------|-----------|');

  sample.forEach((row) => {
    const eoa = row.user_eoa ? row.user_eoa.substring(0, 10) + '...' : 'NULL';
    const proxy = row.proxy_wallet ? row.proxy_wallet.substring(0, 10) + '...' : 'NULL';
    const canonical = row.canonical_wallet.substring(0, 10) + '...';
    const fills = row.fills_count;
    const markets = row.markets_traded;
    const first = row.first_fill_ts.substring(0, 10);
    const last = row.last_fill_ts.substring(0, 10);

    console.log(`| ${eoa} | ${proxy} | ${canonical} | ${fills} | ${markets} | ${first} | ${last} |`);
  });

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`✅ Table created: wallet_identity_map`);
  console.log(`✅ Total (user_eoa, proxy_wallet) pairs: ${totalRows}`);
  console.log(`✅ Distinct canonical wallets: ${distinctCount}`);
  console.log(`✅ Top 50 wallets printed`);
  console.log(`✅ Sample of 15 rows shown\n`);

  console.log('Next: Run script 52 to detect system wallets\n');
}

main().catch(console.error);
