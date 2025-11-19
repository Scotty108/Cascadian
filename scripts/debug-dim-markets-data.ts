#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== Checking dim_markets Data Quality ===\n');
  
  // Get a sample CID from wallet map
  const cidResult = await clickhouse.query({
    query: `
      SELECT cid_hex
      FROM cascadian_clean.system_wallet_map
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const sample = await cidResult.json<Array<{cid_hex: string}>>();
  const cid = sample[0].cid_hex;
  const cidNorm = cid.toLowerCase().replace('0x', '');
  
  console.log(`Sample CID: ${cid}`);
  console.log(`Normalized: ${cidNorm}\n`);
  
  // Check if it exists in dim_markets
  const dimResult = await clickhouse.query({
    query: `
      SELECT *
      FROM default.dim_markets
      WHERE condition_id_norm = '${cidNorm}'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const dimRows = await dimResult.json<Array<any>>();
  
  console.log(`Rows found in dim_markets: ${dimRows.length}\n`);
  
  if (dimRows.length > 0) {
    console.log('Columns:', Object.keys(dimRows[0]).join(', '), '\n');
    console.log('Sample row:');
    console.log(JSON.stringify(dimRows[0], null, 2), '\n');
    
    if (!dimRows[0].question || dimRows[0].question === '') {
      console.log('❌ ISSUE FOUND: question field is NULL or empty!');
      console.log('This explains why no titles appear in the join.\n');
    } else {
      console.log(`✓ Question field exists: "${dimRows[0].question}"\n`);
    }
  } else {
    console.log('❌ No rows found - condition_id_norm mismatch?\n');
  }
  
  // Check dim_markets schema
  console.log('=== dim_markets Schema Sample ===\n');
  const schemaResult = await clickhouse.query({
    query: `
      SELECT *
      FROM default.dim_markets
      WHERE question IS NOT NULL
        AND question != ''
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const schemaRows = await schemaResult.json<Array<any>>();
  
  console.log(`Non-null question rows found: ${schemaRows.length}\n`);
  if (schemaRows.length > 0) {
    schemaRows.forEach((row, i) => {
      console.log(`${i+1}. ${row.question}`);
      console.log(`   CID: ${row.condition_id_norm?.substring(0, 20)}...`);
      console.log(`   Volume: $${parseFloat(row.volume || 0).toFixed(2)}\n`);
    });
  }
}

main().catch(console.error);
