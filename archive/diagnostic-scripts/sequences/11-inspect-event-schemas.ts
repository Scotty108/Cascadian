/**
 * 11: INSPECT EVENT TABLE SCHEMAS
 *
 * Check schema of promising event tables to find ConditionResolution source
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('11: INSPECT EVENT TABLE SCHEMAS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const tables = [
    'gamma_resolved',
    'resolution_candidates',
    'resolutions_external_ingest'
  ];

  for (const table of tables) {
    console.log(`\n📊 ${table}\n`);

    // Get schema
    const schemaQuery = await clickhouse.query({
      query: `DESCRIBE ${table}`,
      format: 'JSONEachRow'
    });

    const schema: any[] = await schemaQuery.json();

    console.log('Columns:');
    console.table(schema.map(s => ({
      name: s.name,
      type: s.type
    })));

    // Sample first row
    const sampleQuery = await clickhouse.query({
      query: `SELECT * FROM ${table} LIMIT 1`,
      format: 'JSONEachRow'
    });

    const sample: any[] = await sampleQuery.json();

    if (sample.length > 0) {
      console.log('\nSample row:');
      console.log(JSON.stringify(sample[0], null, 2));
    }
  }

  console.log('\n✅ SCHEMA INSPECTION COMPLETE\n');
}

main().catch(console.error);
