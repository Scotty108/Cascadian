#!/usr/bin/env npx tsx
/**
 * Task 4 (Fix): Recreate staging table with simpler engine
 * Use MergeTree instead of ReplacingMergeTree for initial population
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 4 (FIX): RECREATE STAGING TABLE WITH MERGETRE E');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Drop and recreate
    console.log('1️⃣  Recreating staging table...\n');

    await ch.query({ query: `DROP TABLE IF EXISTS default.market_metadata_wallet_enriched` });
    console.log(`   ✅ Dropped old table\n`);

    const createQuery = `
      CREATE TABLE default.market_metadata_wallet_enriched (
        condition_id_norm String,
        condition_id_full String,
        title String DEFAULT 'UNKNOWN',
        slug String DEFAULT '',
        description String DEFAULT '',
        category String DEFAULT '',
        data_source String DEFAULT 'none',
        populated_at DateTime DEFAULT now(),
        metadata_complete UInt8 DEFAULT 0
      ) ENGINE = MergeTree()
      ORDER BY condition_id_norm
      PRIMARY KEY condition_id_norm
    `;

    await ch.query({ query: createQuery });
    console.log(`   ✅ Table recreated (MergeTree engine)\n`);

    // Step 2: Load wallet markets
    console.log('2️⃣  Loading wallet markets...\n');

    const walletMarketsQuery = `
      SELECT DISTINCT
        lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
        COUNT(*) as trade_count
      FROM default.trades_raw t
      WHERE lower(t.wallet) = '${WALLET}'
        AND t.condition_id NOT LIKE '%token_%'
      GROUP BY condition_id_norm
      ORDER BY trade_count DESC
    `;

    const walletResult = await ch.query({
      query: walletMarketsQuery,
      format: 'JSONEachRow'
    });
    const walletMarkets = await walletResult.json<any[]>();
    console.log(`   ✅ Found ${walletMarkets.length} wallet markets\n`);

    // Step 3: Insert all rows at once
    console.log('3️⃣  Inserting all rows into staging table...\n');

    const valueParts: string[] = [];

    for (const market of walletMarkets) {
      const escapeStr = (s: string) => (s || '').replace(/'/g, "\\'");
      valueParts.push(
        `('${market.condition_id_norm}', '0x${market.condition_id_norm}', 'UNKNOWN', '', '', '', 'none', now(), 0)`
      );
    }

    const insertQuery = `
      INSERT INTO default.market_metadata_wallet_enriched VALUES
      ${valueParts.join(', ')}
    `;

    await ch.query({ query: insertQuery });
    console.log(`   ✅ Inserted ${walletMarkets.length} rows\n`);

    // Step 4: Verify
    console.log('4️⃣  Verifying table contents...\n');

    const verifyQuery = `SELECT COUNT(*) as count FROM default.market_metadata_wallet_enriched`;
    const verifyResult = await ch.query({
      query: verifyQuery,
      format: 'JSONEachRow'
    });
    const verifyData = await verifyResult.json<any[]>();
    const rowCount = verifyData[0]?.count;

    console.log(`   ✅ Verified: ${rowCount} rows in table\n`);

    if (rowCount > 0) {
      // Show samples
      console.log('5️⃣  Sample rows:\n');

      const sampleQuery = `
        SELECT condition_id_norm, title FROM default.market_metadata_wallet_enriched
        LIMIT 3
      `;

      const sampleResult = await ch.query({
        query: sampleQuery,
        format: 'JSONEachRow'
      });
      const sampleData = await sampleResult.json<any[]>();

      sampleData.forEach((row: any) => {
        console.log(`   • ${row.condition_id_norm.substring(0, 16)}...`);
        console.log(`     Title: "${row.title}"\n`);
      });
    }

    // Final summary
    console.log('═'.repeat(100));
    console.log('STAGING TABLE READY');
    console.log('═'.repeat(100));
    console.log(`
    Staging Table: default.market_metadata_wallet_enriched
    ─────────────────────────────────────────────────────────

    Status:
    • Table engine:         MergeTree (fixed)
    • Total rows:           ${rowCount}/141
    • Metadata complete:    0/141 (ready for hydration)

    Simplified Schema (9 fields):
    • condition_id_norm
    • condition_id_full
    • title
    • slug
    • description
    • category
    • data_source
    • populated_at
    • metadata_complete

    Next Steps:
    1. When gamma_markets/api_markets_staging is populated with wallet data,
       run hydration script to UPDATE titles/slugs
    2. Rerun parity validation to show metadata_coverage
    3. Dashboards can JOIN on condition_id_norm for market lookups

    Hydration Query Pattern:
    ─────────────────────────────────────────────────────────
    UPDATE market_metadata_wallet_enriched AS m
    SET title = g.question, data_source = 'gamma_markets'
    FROM gamma_markets g
    WHERE m.condition_id_norm = lower(replaceAll(g.condition_id, '0x', ''))
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    console.error(e.stack);
  }

  await ch.close();
}

main().catch(console.error);
