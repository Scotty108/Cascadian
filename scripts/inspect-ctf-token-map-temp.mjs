import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function inspectSchema() {
  console.log('='.repeat(80));
  console.log('CTF_TOKEN_MAP SCHEMA INSPECTION');
  console.log('='.repeat(80));

  // Schema
  console.log('\n📋 SCHEMA (DESCRIBE TABLE ctf_token_map):');
  const schemaRes = await clickhouse.query({
    query: `DESCRIBE TABLE ctf_token_map`,
    format: 'JSONEachRow'
  });
  const schema = await schemaRes.json();
  schema.forEach(col => console.log(`  ${col.name.padEnd(30)} ${col.type}`));

  // Sample rows
  console.log('\n\n📝 SAMPLE ROWS (LIMIT 10):');
  const sampleRes = await clickhouse.query({
    query: `SELECT * FROM ctf_token_map LIMIT 10`,
    format: 'JSONEachRow'
  });
  const samples = await sampleRes.json();
  console.table(samples);

  // Check for nulls
  console.log('\n\n🔍 NULL CHECK:');
  const nullCheckRes = await clickhouse.query({
    query: `
      SELECT
        countIf(condition_id IS NULL) as null_condition_ids,
        countIf(token_id IS NULL) as null_token_ids,
        countIf(outcome_index IS NULL) as null_outcome_index,
        count(*) as total_rows
      FROM ctf_token_map
    `,
    format: 'JSONEachRow'
  });
  const nullCheck = await nullCheckRes.json();
  console.table(nullCheck);

  console.log('\n' + '='.repeat(80));
}

inspectSchema().catch(console.error);
