/**
 * 30: INVESTIGATE CTF_TOKEN_MAP DECODE
 *
 * Check how condition_ids are being decoded from token IDs
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('30: INVESTIGATE CTF_TOKEN_MAP DECODE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Check ctf_token_map_norm schema...\n');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE ctf_token_map_norm`,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaQuery.json();

  console.log('Schema:');
  console.table(schema.map(s => ({ name: s.name, type: s.type })));

  console.log('\n📊 Step 2: Sample data showing token_id and decoded condition_id...\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        token_id_dec,
        condition_id_norm,
        market_id,
        outcome_index,
        length(token_id_dec) AS token_id_len,
        length(condition_id_norm) AS cid_len
      FROM ctf_token_map_norm
      WHERE condition_id_norm IS NOT NULL AND condition_id_norm != ''
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  console.log('Sample decoded tokens:');
  console.table(samples.map(s => ({
    asset_id: s.asset_id,
    token_id: s.token_id_dec.substring(0, 20) + '...',
    token_id_len: s.token_id_len,
    condition_id: s.condition_id_norm.substring(0, 20) + '...',
    market_id: s.market_id ? s.market_id.substring(0, 20) + '...' : 'null',
    cid_len: s.cid_len,
    outcome: s.outcome_index
  })));

  console.log('\n📊 Step 3: Check if ctf_token_map_norm is a view or table...\n');

  const tableInfoQuery = await clickhouse.query({
    query: `
      SELECT engine, create_table_query
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = 'ctf_token_map_norm'
    `,
    format: 'JSONEachRow'
  });

  const tableInfo: any = (await tableInfoQuery.json())[0];

  console.log(`Engine: ${tableInfo.engine}\n`);

  if (tableInfo.engine === 'View' || tableInfo.engine.includes('Materialized')) {
    console.log('CREATE statement:');
    console.log(tableInfo.create_table_query);
    console.log('\n');
  }

  console.log('📊 Step 4: Check original ctf_token_map table...\n');

  try {
    const origSchemaQuery = await clickhouse.query({
      query: `DESCRIBE ctf_token_map`,
      format: 'JSONEachRow'
    });

    const origSchema: any[] = await origSchemaQuery.json();

    console.log('Original ctf_token_map schema:');
    console.table(origSchema.map(s => ({ name: s.name, type: s.type })));

    // Sample from original
    const origSampleQuery = await clickhouse.query({
      query: `SELECT * FROM ctf_token_map LIMIT 5`,
      format: 'JSONEachRow'
    });

    const origSamples: any[] = await origSampleQuery.json();

    console.log('\nOriginal ctf_token_map sample:');
    console.log(JSON.stringify(origSamples, null, 2));
  } catch (e: any) {
    console.log(`❌ ctf_token_map does not exist: ${e.message}\n`);
  }

  console.log('\n✅ INVESTIGATION COMPLETE\n');
}

main().catch(console.error);
