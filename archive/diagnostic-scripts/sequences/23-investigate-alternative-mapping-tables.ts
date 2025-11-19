/**
 * 23: INVESTIGATE ALTERNATIVE MAPPING TABLES
 *
 * Check condition_market_map and other alternatives for better coverage
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('23: INVESTIGATE ALTERNATIVE MAPPING TABLES');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Check condition_market_map schema and sample...\n');

  try {
    const schemaQuery = await clickhouse.query({
      query: `DESCRIBE condition_market_map`,
      format: 'JSONEachRow'
    });

    const schema: any[] = await schemaQuery.json();

    console.log('condition_market_map schema:');
    console.table(schema.map(s => ({ name: s.name, type: s.type })));

    // Sample data
    const sampleQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM condition_market_map
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const samples: any[] = await sampleQuery.json();

    console.log('\nSample rows:');
    console.log(JSON.stringify(samples, null, 2));

    // Check coverage
    const coverageQuery = await clickhouse.query({
      query: `
        SELECT
          count() AS total_rows,
          countIf(condition_id IS NOT NULL AND condition_id != '') AS has_condition_id,
          countIf(market_id IS NOT NULL AND market_id != '') AS has_market_id
        FROM condition_market_map
      `,
      format: 'JSONEachRow'
    });

    const coverage: any = (await coverageQuery.json())[0];

    console.log('\nCoverage:');
    console.log(`  Total rows: ${parseInt(coverage.total_rows).toLocaleString()}`);
    console.log(`  Has condition_id: ${parseInt(coverage.has_condition_id).toLocaleString()}`);
    console.log(`  Has market_id: ${parseInt(coverage.has_market_id).toLocaleString()}`);

  } catch (e: any) {
    console.log('❌ condition_market_map does not exist:', e.message);
  }

  console.log('\n📊 Step 2: Check erc1155_condition_map...\n');

  try {
    const schemaQuery = await clickhouse.query({
      query: `DESCRIBE erc1155_condition_map`,
      format: 'JSONEachRow'
    });

    const schema: any[] = await schemaQuery.json();

    console.log('erc1155_condition_map schema:');
    console.table(schema.map(s => ({ name: s.name, type: s.type })));

    // Sample
    const sampleQuery = await clickhouse.query({
      query: `SELECT * FROM erc1155_condition_map LIMIT 5`,
      format: 'JSONEachRow'
    });

    const samples: any[] = await sampleQuery.json();
    console.log('\nSample rows:');
    console.log(JSON.stringify(samples, null, 2));

  } catch (e: any) {
    console.log('❌ erc1155_condition_map does not exist:', e.message);
  }

  console.log('\n📊 Step 3: List all tables with "condition" or "market" in name...\n');

  const tablesQuery = await clickhouse.query({
    query: `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND (
          name LIKE '%condition%'
          OR name LIKE '%market%'
          OR name LIKE '%map%'
        )
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await tablesQuery.json();

  console.log('Tables with condition/market/map:');
  console.table(tables.map(t => ({
    name: t.name,
    engine: t.engine,
    rows: parseInt(t.total_rows).toLocaleString()
  })));

  console.log('\n✅ INVESTIGATION COMPLETE\n');
}

main().catch(console.error);
