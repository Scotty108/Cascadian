#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function checkTable(tableName: string) {
  try {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`Checking: ${tableName}`);
    console.log('─'.repeat(80));

    // Get row count
    const count = await client.query({
      query: `SELECT count() AS cnt FROM default.${tableName}`,
      format: 'JSONEachRow',
    });
    const cnt = (await count.json<Array<{ cnt: number }>>())[0].cnt;
    console.log(`Rows: ${cnt.toLocaleString()}`);

    // Get schema
    const schema = await client.query({
      query: `DESCRIBE TABLE default.${tableName}`,
      format: 'JSONEachRow',
    });
    const cols = await schema.json<Array<{ name: string; type: string }>>();
    console.log('Columns:', cols.map(c => c.name).join(', '));

    // Check for condition_id or related columns
    const conditionCols = cols.filter(c =>
      c.name.toLowerCase().includes('condition') ||
      c.name.toLowerCase().includes('cid') ||
      c.name.toLowerCase().includes('market')
    );

    if (conditionCols.length > 0) {
      console.log('  → Relevant columns:', conditionCols.map(c => c.name).join(', '));
    }

    // Get sample
    const sample = await client.query({
      query: `SELECT * FROM default.${tableName} LIMIT 2`,
      format: 'JSONEachRow',
    });
    const rows = await sample.json();
    console.log('\nSample:');
    console.log(JSON.stringify(rows, null, 2).substring(0, 500));

    return true;
  } catch (error: any) {
    console.log(`\n❌ Error: ${error.message.substring(0, 100)}`);
    return false;
  }
}

async function main() {
  console.log('CHECKING USER-SUGGESTED TABLES FOR RESOLUTION DATA');
  console.log('═'.repeat(80));

  const tablesToCheck = [
    'outcome_positions_v2',
    'market_resolutions_by_market',
    'market_resolutions',
    'market_resolution_map',
    'market_outcomes',
    'market_key_map',
    'market_id_mapping',
    'market_flow_metrics',
    'id_bridge',
  ];

  for (const table of tablesToCheck) {
    await checkTable(table);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('DONE');
  console.log('═'.repeat(80));

  await client.close();
}

main().catch(console.error);
