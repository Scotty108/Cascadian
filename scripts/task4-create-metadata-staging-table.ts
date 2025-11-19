#!/usr/bin/env npx tsx
/**
 * Task 4: Create & Populate market_metadata_wallet_enriched Staging Table
 *
 * Creates a dedicated staging table for wallet metadata enrichment.
 * Hydrates 141 markets with titles/slugs from Gamma/API sources.
 * Leaves existing tables untouched; ready for dashboard joins.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 4: CREATE MARKET METADATA STAGING TABLE - Option B (New Table)');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Drop old table if exists (safe reset for development)
    console.log('1️⃣  Setting up staging table...\n');

    const dropQuery = `DROP TABLE IF EXISTS default.market_metadata_wallet_enriched`;
    await ch.query({ query: dropQuery });
    console.log(`   ✅ Cleaned up old table (if existed)\n`);

    // Step 2: Create the staging table
    console.log('2️⃣  Creating market_metadata_wallet_enriched table...\n');

    const createQuery = `
      CREATE TABLE default.market_metadata_wallet_enriched (
        condition_id_norm String,
        condition_id_full String,
        title String DEFAULT 'UNKNOWN',
        slug String DEFAULT '',
        description String DEFAULT '',
        category String DEFAULT '',
        data_source String DEFAULT 'none',
        gamma_question String DEFAULT '',
        gamma_description String DEFAULT '',
        gamma_category String DEFAULT '',
        api_slug String DEFAULT '',
        api_question String DEFAULT '',
        api_description String DEFAULT '',
        populated_at DateTime DEFAULT now(),
        metadata_complete UInt8 DEFAULT 0
      ) ENGINE = ReplacingMergeTree()
      ORDER BY condition_id_norm
      PRIMARY KEY condition_id_norm
    `;

    await ch.query({ query: createQuery });
    console.log(`   ✅ Table created with composite metadata fields\n`);

    // Step 3: Get wallet's condition IDs
    console.log('3️⃣  Loading wallet markets...\n');

    const walletMarketsQuery = `
      SELECT DISTINCT
        lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
        COUNT(*) as trade_count,
        MAX(t.block_time) as last_trade
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

    // Step 4: Fetch from gamma_markets
    console.log('4️⃣  Fetching metadata from gamma_markets...\n');

    let gammaData: any[] = [];
    try {
      const gammaQuery = `
        SELECT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
          question,
          description,
          category
        FROM default.gamma_markets
        WHERE lower(replaceAll(condition_id, '0x', '')) IN (${cidList})
      `;

      const gammaResult = await ch.query({
        query: gammaQuery,
        format: 'JSONEachRow'
      });
      gammaData = await gammaResult.json<any[]>();
    } catch (e: any) {
      console.log(`   ⚠️  gamma_markets query error: ${e.message}`);
    }

    console.log(`   ✅ Retrieved ${gammaData.length}/141 from gamma_markets\n`);

    // Step 5: Fetch from api_markets_staging
    console.log('5️⃣  Fetching metadata from api_markets_staging...\n');

    let apiData: any[] = [];
    try {
      const apiQuery = `
        SELECT
          lower(condition_id) as condition_id_norm,
          question,
          description,
          market_slug
        FROM default.api_markets_staging
        WHERE lower(condition_id) IN (${cidList})
      `;

      const apiResult = await ch.query({
        query: apiQuery,
        format: 'JSONEachRow'
      });
      apiData = await apiResult.json<any[]>();
    } catch (e: any) {
      console.log(`   ⚠️  api_markets_staging query error: ${e.message}`);
    }

    console.log(`   ✅ Retrieved ${apiData.length}/141 from api_markets_staging\n`);

    // Step 6: Build merged dataset
    console.log('6️⃣  Merging metadata sources...\n');

    const gammaMap = new Map(gammaData.map((g: any) => [g.condition_id_norm, g]));
    const apiMap = new Map(apiData.map((a: any) => [a.condition_id_norm, a]));

    const enrichedRows: any[] = [];
    let gammaHits = 0;
    let apiHits = 0;
    let fullHits = 0;

    for (const market of walletMarkets) {
      const gamma = gammaMap.get(market.condition_id_norm);
      const api = apiMap.get(market.condition_id_norm);

      let title = 'UNKNOWN';
      let description = '';
      let category = '';
      let slug = '';
      let dataSource = 'none';
      let metadataComplete = false;

      // Cascade logic: prefer gamma for title, api for slug
      if (gamma?.question) {
        title = gamma.question;
        description = gamma.description || '';
        category = gamma.category || '';
        dataSource = 'gamma_markets';
        gammaHits++;
        metadataComplete = true;
      } else if (api?.question) {
        title = api.question;
        description = api.description || '';
        dataSource = 'api_markets_staging';
        apiHits++;
        metadataComplete = true;
      }

      // Always prefer api slug if available
      if (api?.market_slug) {
        slug = api.market_slug;
      }

      if (metadataComplete) fullHits++;

      enrichedRows.push({
        condition_id_norm: market.condition_id_norm,
        condition_id_full: '0x' + market.condition_id_norm,
        title: title,
        slug: slug,
        description: description.substring(0, 500),
        category: category,
        data_source: dataSource,
        gamma_question: gamma?.question || '',
        gamma_description: gamma?.description || '',
        gamma_category: gamma?.category || '',
        api_slug: api?.market_slug || '',
        api_question: api?.question || '',
        api_description: api?.description || '',
        metadata_complete: metadataComplete ? 1 : 0
      });
    }

    console.log(`   Merge Results:`);
    console.log(`   • From gamma_markets:    ${gammaHits}/141`);
    console.log(`   • From api_markets_staging: ${apiHits}/141`);
    console.log(`   • Total complete:        ${fullHits}/141 (${((fullHits / 141) * 100).toFixed(1)}%)\n`);

    // Step 7: Insert into staging table
    console.log('7️⃣  Inserting enriched data into staging table...\n');

    const insertQuery = `
      INSERT INTO default.market_metadata_wallet_enriched VALUES
      ${enrichedRows
        .map(
          (row) => `(
        '${row.condition_id_norm}',
        '${row.condition_id_full}',
        '${row.title.replace(/'/g, "\\'")}',
        '${row.slug.replace(/'/g, "\\'")}',
        '${row.description.replace(/'/g, "\\'")}',
        '${row.category.replace(/'/g, "\\'")}',
        '${row.data_source}',
        '${row.gamma_question.replace(/'/g, "\\'")}',
        '${row.gamma_description.replace(/'/g, "\\'")}',
        '${row.gamma_category.replace(/'/g, "\\'")}',
        '${row.api_slug.replace(/'/g, "\\'")}',
        '${row.api_question.replace(/'/g, "\\'")}',
        '${row.api_description.replace(/'/g, "\\'")}',
        now(),
        ${row.metadata_complete}
      )`
        )
        .join(', ')}
    `;

    await ch.query({ query: insertQuery });
    console.log(`   ✅ Inserted ${enrichedRows.length} rows into staging table\n`);

    // Step 8: Verify insert
    console.log('8️⃣  Verifying staging table...\n');

    const verifyQuery = `
      SELECT
        COUNT(*) as total_rows,
        SUM(metadata_complete) as rows_with_metadata,
        SUM(if(data_source = 'gamma_markets', 1, 0)) as from_gamma,
        SUM(if(data_source = 'api_markets_staging', 1, 0)) as from_api,
        SUM(if(data_source = 'none', 1, 0)) as unfilled
      FROM default.market_metadata_wallet_enriched
    `;

    const verifyResult = await ch.query({
      query: verifyQuery,
      format: 'JSONEachRow'
    });
    const verifyData = await verifyResult.json<any[]>();
    const verification = verifyData[0];

    console.log(`   Staging Table Verification:`);
    console.log(`   • Total rows:           ${verification.total_rows}`);
    console.log(`   • With metadata:        ${verification.rows_with_metadata}/${verification.total_rows}`);
    console.log(`   • From gamma_markets:   ${verification.from_gamma}`);
    console.log(`   • From api_markets_staging: ${verification.from_api}`);
    console.log(`   • Unfilled:             ${verification.unfilled}\n`);

    // Step 9: Show sample rows
    console.log('9️⃣  Sample rows from staging table:\n');

    const sampleQuery = `
      SELECT
        condition_id_norm,
        title,
        slug,
        data_source,
        metadata_complete
      FROM default.market_metadata_wallet_enriched
      WHERE metadata_complete = 1
      LIMIT 3
    `;

    const sampleResult = await ch.query({
      query: sampleQuery,
      format: 'JSONEachRow'
    });
    const sampleData = await sampleResult.json<any[]>();

    if (sampleData.length > 0) {
      sampleData.forEach((row: any) => {
        console.log(`   • ${row.condition_id_norm.substring(0, 16)}...`);
        console.log(`     Title: ${row.title.substring(0, 60)}`);
        console.log(`     Slug: ${row.slug || '(empty)'}`);
        console.log(`     Source: ${row.data_source}\n`);
      });
    } else {
      console.log(`   (No rows with complete metadata to display)\n`);
    }

    // Final summary
    console.log('═'.repeat(100));
    console.log('STAGING TABLE CREATED & POPULATED');
    console.log('═'.repeat(100));
    console.log(`
    Staging Table: default.market_metadata_wallet_enriched
    ─────────────────────────────────────────────────────────

    Status:
    • Total markets:        ${verification.total_rows}/141
    • With metadata:        ${verification.rows_with_metadata}/141 (${((parseInt(verification.rows_with_metadata as any) / 141) * 100).toFixed(1)}%)
    • From gamma_markets:   ${verification.from_gamma}
    • From api_markets_staging: ${verification.from_api}
    • Still unfilled:       ${verification.unfilled}

    Table Location:
    • Database: default
    • Table: market_metadata_wallet_enriched
    • Engine: ReplacingMergeTree
    • Order by: condition_id_norm

    Key Fields:
    • condition_id_norm: Normalized (no 0x prefix, lowercase)
    • condition_id_full: Full format (0x prefix)
    • title: Primary title (GAMMA or API source)
    • slug: Market slug (from API)
    • data_source: Which table provided primary data
    • metadata_complete: 1 if title found, 0 if still UNKNOWN

    Next Steps:
    1. Verify staging table data quality (SELECT * with sampling)
    2. Rerun parity script to validate metadata_coverage = 100%
    3. Update dashboard to JOIN on condition_id_norm
    4. Once validated, can merge into gamma_markets or keep as staging

    Dashboard Join Example:
    ─────────────────────────────────────────────────────────
    SELECT
      t.condition_id_norm,
      t.net_shares,
      t.pnl_usd,
      m.title,
      m.slug,
      m.category
    FROM trades_with_direction t
    LEFT JOIN market_metadata_wallet_enriched m
      ON t.condition_id_norm = m.condition_id_norm
    WHERE t.wallet = '${WALLET}'
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    console.error(e.stack);
  }

  await ch.close();
}

main().catch(console.error);
