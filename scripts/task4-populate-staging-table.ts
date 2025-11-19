#!/usr/bin/env npx tsx
/**
 * Task 4 (Revised): Populate market_metadata_wallet_enriched Staging Table
 *
 * Simplified INSERT with better error handling.
 * Batched in smaller chunks to avoid large VALUES clause issues.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 4 (REVISED): POPULATE STAGING TABLE WITH FALLBACK DATA');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Get wallet's condition IDs
    console.log('1️⃣  Loading wallet markets...\n');

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

    const cidList = walletMarkets.map((m: any) => `'${m.condition_id_norm}'`).join(',');

    // Step 2: Build enriched data in memory
    console.log('2️⃣  Building enriched metadata in memory...\n');

    const enrichedRows: any[] = [];

    for (const market of walletMarkets) {
      enrichedRows.push({
        condition_id_norm: market.condition_id_norm,
        condition_id_full: '0x' + market.condition_id_norm,
        title: 'UNKNOWN',
        slug: '',
        description: '',
        category: '',
        data_source: 'none',
        gamma_question: '',
        gamma_description: '',
        gamma_category: '',
        api_slug: '',
        api_question: '',
        api_description: '',
        metadata_complete: 0
      });
    }

    console.log(`   ✅ Prepared ${enrichedRows.length} rows for insertion\n`);

    // Step 3: Insert in batches
    console.log('3️⃣  Inserting data in batches...\n');

    const BATCH_SIZE = 20;
    let inserted = 0;

    for (let i = 0; i < enrichedRows.length; i += BATCH_SIZE) {
      const batch = enrichedRows.slice(i, i + BATCH_SIZE);
      const valueParts: string[] = [];

      for (const row of batch) {
        // Escape single quotes in strings
        const escapeStr = (s: string) => (s || '').replace(/'/g, "\\'");

        valueParts.push(
          `('${row.condition_id_norm}', '${row.condition_id_full}', '${escapeStr(row.title)}', '${escapeStr(row.slug)}', '${escapeStr(row.description)}', '${escapeStr(row.category)}', '${row.data_source}', '${escapeStr(row.gamma_question)}', '${escapeStr(row.gamma_description)}', '${escapeStr(row.gamma_category)}', '${escapeStr(row.api_slug)}', '${escapeStr(row.api_question)}', '${escapeStr(row.api_description)}', now(), ${row.metadata_complete})`
        );
      }

      const insertQuery = `
        INSERT INTO default.market_metadata_wallet_enriched VALUES
        ${valueParts.join(', ')}
      `;

      try {
        await ch.query({ query: insertQuery });
        inserted += batch.length;
        console.log(`   ✅ Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${inserted}/${enrichedRows.length}`);
      } catch (e: any) {
        console.error(`   ❌ Batch insertion error: ${e.message}`);
        throw e;
      }
    }

    console.log(`\n   ✅ All ${inserted} rows inserted successfully\n`);

    // Step 4: Wait a moment for ReplacingMergeTree to finalize
    console.log('4️⃣  Waiting for table finalization...\n');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 5: Verify insert
    console.log('5️⃣  Verifying staging table...\n');

    const verifyQuery = `
      SELECT
        COUNT(*) as total_rows,
        SUM(metadata_complete) as rows_with_metadata
      FROM default.market_metadata_wallet_enriched
    `;

    const verifyResult = await ch.query({
      query: verifyQuery,
      format: 'JSONEachRow'
    });
    const verifyData = await verifyResult.json<any[]>();
    const verification = verifyData[0];

    console.log(`   Verification Results:`);
    console.log(`   • Total rows:        ${verification.total_rows}`);
    console.log(`   • With metadata:     ${verification.rows_with_metadata}/${verification.total_rows}\n`);

    // Step 6: Show sample
    console.log('6️⃣  Sample rows from staging table:\n');

    const sampleQuery = `
      SELECT
        condition_id_norm,
        title,
        data_source
      FROM default.market_metadata_wallet_enriched
      LIMIT 3
    `;

    const sampleResult = await ch.query({
      query: sampleQuery,
      format: 'JSONEachRow'
    });
    const sampleData = await sampleResult.json<any[]>();

    sampleData.forEach((row: any) => {
      console.log(`   • ${row.condition_id_norm}`);
      console.log(`     Title: ${row.title}`);
      console.log(`     Source: ${row.data_source}\n`);
    });

    // Final summary
    console.log('═'.repeat(100));
    console.log('STAGING TABLE POPULATED');
    console.log('═'.repeat(100));
    console.log(`
    Status:
    • Total rows inserted:  ${verification.total_rows}/141
    • Ready for hydration:  ✅ Yes

    Next Steps:
    1. When gamma_markets/api_markets_staging is backfilled with wallet market data,
       rerun the hydration script to populate titles/slugs
    2. Rerun parity script to validate metadata_coverage = 100%
    3. Update dashboards to JOIN on condition_id_norm

    Table Location: default.market_metadata_wallet_enriched
    Schema: 15 columns (condition_id_norm, condition_id_full, title, slug, etc.)
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    console.error(e.stack);
  }

  await ch.close();
}

main().catch(console.error);
