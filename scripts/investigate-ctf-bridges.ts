#!/usr/bin/env tsx
/**
 * Investigate Existing CTF Bridge Tables
 *
 * Check if we already have mappings between ERC1155 token_id and condition_id
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function investigateTable(tableName: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Table: ${tableName}`);
  console.log('='.repeat(60));

  // Get schema
  const schemaResult = await clickhouse.query({
    query: `DESCRIBE TABLE ${tableName}`,
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json();

  console.log('\nSchema:');
  console.table(schema);

  // Get sample rows
  const sampleResult = await clickhouse.query({
    query: `SELECT * FROM ${tableName} LIMIT 3`,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json();

  console.log('\nSample rows:');
  samples.forEach((row: any, i: number) => {
    console.log(`\nRow ${i + 1}:`);
    console.log(JSON.stringify(row, null, 2));
  });

  // Get row count
  const countResult = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM ${tableName}`,
    format: 'JSONEachRow'
  });
  const count = await countResult.json();
  console.log(`\nTotal rows: ${count[0].cnt}`);
}

async function main() {
  console.log('🔍 Investigating Existing CTF Bridge Tables');
  console.log('='.repeat(60));

  const tablesToInvestigate = [
    'erc1155_condition_map',
    'ctf_to_market_bridge_mat',
    'api_ctf_bridge',
    'condition_market_map'
  ];

  for (const table of tablesToInvestigate) {
    try {
      await investigateTable(table);
    } catch (error) {
      console.error(`\n❌ Error investigating ${table}:`, error);
    }
  }

  console.log('\n✅ Investigation complete!');
}

main().catch(console.error);
