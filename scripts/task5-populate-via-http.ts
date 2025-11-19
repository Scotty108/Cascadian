#!/usr/bin/env npx tsx
/**
 * Task 5: Populate Staging Table via HTTP API (Direct Query String)
 *
 * Bypasses the client library by sending raw INSERT as query string parameter
 * to ClickHouse HTTP API. This forces synchronous execution.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import https from 'https';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function executeQuery(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const queryPath = `/? ${new URLSearchParams({
      query: query,
      default_format: 'JSONEachRow'
    }).toString()}`;

    const options = {
      hostname: process.env.CLICKHOUSE_HOST || 'localhost',
      port: process.env.CLICKHOUSE_PORT || 8443,
      path: queryPath,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      }
    };

    if (process.env.CLICKHOUSE_USER) {
      options['auth'] = `${process.env.CLICKHOUSE_USER}:${process.env.CLICKHOUSE_PASSWORD || ''}`;
    }

    console.log(`  Connecting to: ${options.hostname}:${options.port}`);
    console.log(`  Using HTTPS: ${options.port === 8443}\n`);

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write('');
    req.end();
  });
}

async function main() {
  console.log('\n' + '═'.repeat(100));
  console.log('TASK 5: POPULATE STAGING TABLE VIA HTTP API');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Test connection
    console.log('1️⃣  Testing ClickHouse connection...\n');
    try {
      const testResult = await executeQuery('SELECT 1 as test');
      console.log(`   ✅ Connection successful\n`);
    } catch (e: any) {
      console.error(`   ❌ Connection failed: ${e.message}`);
      throw e;
    }

    // Step 2: Verify staging table exists
    console.log('2️⃣  Verifying staging table exists...\n');
    try {
      const describeResult = await executeQuery(
        'DESCRIBE TABLE default.market_metadata_wallet_enriched'
      );
      console.log(`   ✅ Table exists\n`);
    } catch (e: any) {
      console.error(`   ❌ Table check failed: ${e.message}`);
      throw e;
    }

    // Step 3: Execute INSERT with SELECT (avoids multi-row VALUES issue)
    console.log('3️⃣  Inserting 141 wallet markets via INSERT...SELECT...\n');

    const insertQuery = `
      INSERT INTO default.market_metadata_wallet_enriched
      SELECT
        lower(replaceAll(condition_id, '0x', ''))         AS condition_id_norm,
        concat('0x', lower(replaceAll(condition_id,'0x',''))) AS condition_id_full,
        'UNKNOWN'                                        AS title,
        ''                                               AS slug,
        ''                                               AS description,
        ''                                               AS category,
        'none'                                           AS data_source,
        now()                                            AS populated_at,
        0                                                AS metadata_complete
      FROM default.trades_raw
      WHERE lower(wallet) = '${WALLET}'
        AND condition_id NOT LIKE '%token_%'
      GROUP BY condition_id_norm, condition_id_full
    `;

    try {
      await executeQuery(insertQuery);
      console.log(`   ✅ INSERT executed successfully\n`);
    } catch (e: any) {
      console.error(`   ❌ INSERT failed: ${e.message}`);
      throw e;
    }

    // Step 4: Wait for finalization
    console.log('4️⃣  Waiting for data finalization...\n');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 5: Verify data
    console.log('5️⃣  Verifying data persistence...\n');

    const verifyQuery = `
      SELECT
        COUNT(*) as total_rows,
        SUM(metadata_complete) as with_metadata,
        COUNT(DISTINCT condition_id_norm) as distinct_markets
      FROM default.market_metadata_wallet_enriched
    `;

    try {
      const verifyResult = await executeQuery(verifyQuery);
      const data = JSON.parse(verifyResult);

      console.log(`   Verification Results:`);
      console.log(`   • Total rows:       ${data[0]?.total_rows || 0}`);
      console.log(`   • With metadata:    ${data[0]?.with_metadata || 0}`);
      console.log(`   • Distinct markets: ${data[0]?.distinct_markets || 0}\n`);

      if ((data[0]?.total_rows || 0) > 0) {
        console.log(`   ✅ Data successfully persisted!\n`);
      } else {
        console.log(`   ⚠️  No rows found - data may not have persisted\n`);
      }
    } catch (e: any) {
      console.error(`   ❌ Verification failed: ${e.message}`);
      throw e;
    }

    // Step 6: Show sample rows
    if ((data[0]?.total_rows || 0) > 0) {
      console.log('6️⃣  Sample rows from staging table:\n');

      const sampleQuery = `
        SELECT condition_id_norm, title, data_source
        FROM default.market_metadata_wallet_enriched
        LIMIT 5
      `;

      try {
        const sampleResult = await executeQuery(sampleQuery);
        const samples = JSON.parse(sampleResult);

        samples.forEach((row: any) => {
          console.log(`   • ${row.condition_id_norm.substring(0, 16)}...`);
          console.log(`     Title: "${row.title}"`);
          console.log(`     Source: ${row.data_source}\n`);
        });
      } catch (e: any) {
        console.log(`   (Could not fetch samples: ${e.message})`);
      }
    }

    // Final summary
    console.log('═'.repeat(100));
    console.log('STAGING TABLE POPULATED');
    console.log('═'.repeat(100));
    console.log(`
    Status:
    • Total rows inserted:  ${data[0]?.total_rows || 0}/141
    • All with "UNKNOWN" titles (ready for hydration)

    Next Steps:
    1. Run hydration script to populate titles from gamma_markets/api_markets_staging
    2. Rerun parity validation to show metadata_coverage = 100%
    3. Update dashboards to use staging table for market lookups

    Staging Table: default.market_metadata_wallet_enriched
    Ready for hydration updates.
    `);

  } catch (e: any) {
    console.error(`\n❌ ERROR: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main().catch(console.error);
