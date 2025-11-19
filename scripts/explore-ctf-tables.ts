#!/usr/bin/env tsx
/**
 * Explore CTF-Related Tables
 *
 * Find tables that might contain CTF condition/event data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔍 Exploring CTF-Related Tables');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Find tables with relevant names
  console.log('Step 1: Finding tables with CTF/condition/event keywords...');

  const tablesQuery = await clickhouse.query({
    query: `
      SELECT
        name,
        total_rows,
        formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = currentDatabase()
        AND (
          name LIKE '%ctf%'
          OR name LIKE '%condition%'
          OR name LIKE '%event%'
          OR name LIKE '%position%'
          OR name LIKE '%split%'
          OR name LIKE '%merge%'
        )
        AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const tables = await tablesQuery.json<{name: string, total_rows: string, size: string}>();

  console.log(`Found ${tables.length} tables with data:\n`);
  console.table(tables);
  console.log('');

  // Step 2: Check if we have condition_id in erc1155_transfers
  console.log('Step 2: Checking erc1155_transfers for condition_id patterns...');

  const sampleERC = await clickhouse.query({
    query: `
      SELECT
        token_id,
        from_address,
        to_address,
        tx_hash,
        block_number
      FROM erc1155_transfers
      WHERE token_id != '' AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY block_number DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const ercSamples = await sampleERC.json();
  console.log('Sample ERC1155 transfers:');
  ercSamples.forEach((row: any, i: number) => {
    console.log(`${i + 1}. token_id: ${row.token_id}`);
    console.log(`   tx: ${row.tx_hash}`);
    console.log('');
  });

  // Step 3: Check ctf_token_map for condition_id linkage
  console.log('Step 3: Checking ctf_token_map condition linkage...');

  const sampleCTF = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        question,
        outcome,
        outcomes_json,
        COUNT(*) as token_count
      FROM ctf_token_map
      GROUP BY condition_id_norm, question, outcome, outcomes_json
      ORDER BY token_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const ctfSamples = await sampleCTF.json();
  console.log('Sample conditions from ctf_token_map:');
  ctfSamples.forEach((row: any, i: number) => {
    console.log(`${i + 1}. condition_id: ${row.condition_id_norm}`);
    console.log(`   question: ${row.question}`);
    console.log(`   outcome: ${row.outcome}`);
    console.log(`   outcomes: ${row.outcomes_json}`);
    console.log(`   tokens: ${row.token_count}`);
    console.log('');
  });

  // Step 4: Check market_key_map for comprehensive condition coverage
  console.log('Step 4: Checking market_key_map...');

  const marketKeyCount = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM market_key_map`,
    format: 'JSONEachRow'
  });
  const mkCount = await marketKeyCount.json();

  console.log(`market_key_map row count: ${mkCount[0].cnt}`);

  const marketKeySample = await clickhouse.query({
    query: `
      SELECT *
      FROM market_key_map
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });

  const mkSamples = await marketKeySample.json();
  console.log('\nSample from market_key_map:');
  console.log(JSON.stringify(mkSamples, null, 2));
  console.log('');

  console.log('✅ Exploration complete!');
}

main().catch(console.error);
