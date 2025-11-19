import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function analyzeERC1155Sources() {
  console.log('\n🔍 PHASE 2: ANALYZING ERC1155 SOURCE TABLES\n');
  console.log('='.repeat(80));

  // List of potential ERC1155 tables to check
  const potentialTables = [
    'erc1155_transfers',
    'pm_erc1155_flats',
    'erc1155_majority_vote',
    'erc1155_condition_map',
    'erc1155_token_votes'
  ];

  console.log('\n1️⃣ Checking which ERC1155 tables exist:\n');

  for (const table of potentialTables) {
    try {
      const existsQuery = `SELECT count() as cnt FROM ${table} LIMIT 1`;
      await clickhouse.query({ query: existsQuery, format: 'JSONEachRow' });
      console.log(`   ✅ ${table} exists`);
    } catch (e) {
      console.log(`   ❌ ${table} does not exist`);
    }
  }

  console.log('\n2️⃣ Analyzing erc1155_transfers:\n');

  try {
    // Get schema
    const schemaQuery = `DESCRIBE TABLE erc1155_transfers`;
    const schemaResult = await clickhouse.query({
      query: schemaQuery,
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();

    console.log('   Schema:');
    schema.forEach((col: any) => {
      console.log(`     - ${col.name}: ${col.type}`);
    });

    // Get row count and sample
    const statsQuery = `
      SELECT
        count() as total_rows,
        uniq(token_id) as unique_tokens,
        min(block_timestamp) as earliest_transfer,
        max(block_timestamp) as latest_transfer
      FROM erc1155_transfers
    `;

    const statsResult = await clickhouse.query({
      query: statsQuery,
      format: 'JSONEachRow'
    });
    const stats = await statsResult.json();

    console.log('\n   Stats:');
    console.log(`     Total rows: ${parseInt(stats[0].total_rows).toLocaleString()}`);
    console.log(`     Unique tokens: ${parseInt(stats[0].unique_tokens).toLocaleString()}`);
    console.log(`     Date range: ${stats[0].earliest_transfer} to ${stats[0].latest_transfer}`);

    // Sample data
    const sampleQuery = `
      SELECT
        token_id,
        from_address,
        to_address,
        amount
      FROM erc1155_transfers
      WHERE token_id != ''
      LIMIT 3
    `;

    const sampleResult = await clickhouse.query({
      query: sampleQuery,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json();

    console.log('\n   Sample rows:');
    console.table(samples);

  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n3️⃣ Checking if erc1155_transfers tokens match clob_fills asset_ids:\n');

  try {
    const matchQuery = `
      SELECT
        countIf(cf.asset_id IN (
          SELECT DISTINCT token_id FROM erc1155_transfers
        )) as matched_fills,
        count() as total_fills,
        round(matched_fills / total_fills * 100, 2) as match_pct
      FROM clob_fills cf
      WHERE cf.asset_id != ''
    `;

    const matchResult = await clickhouse.query({
      query: matchQuery,
      format: 'JSONEachRow'
    });
    const match = await matchResult.json();

    console.log(`   Matched fills: ${parseInt(match[0].matched_fills).toLocaleString()}`);
    console.log(`   Total fills: ${parseInt(match[0].total_fills).toLocaleString()}`);
    console.log(`   Match rate: ${match[0].match_pct}%`);

  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n4️⃣ Checking unmapped tokens in erc1155_transfers:\n');

  try {
    const unmappedQuery = `
      SELECT
        uniq(et.token_id) as unmapped_tokens_in_erc1155
      FROM erc1155_transfers et
      LEFT JOIN ctf_token_map c ON et.token_id = c.token_id
      WHERE et.token_id != ''
        AND c.token_id IS NULL
    `;

    const unmappedResult = await clickhouse.query({
      query: unmappedQuery,
      format: 'JSONEachRow'
    });
    const unmapped = await unmappedResult.json();

    console.log(`   Unmapped tokens: ${parseInt(unmapped[0].unmapped_tokens_in_erc1155).toLocaleString()}`);

  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 ASSESSMENT:\n');
  console.log('If erc1155_transfers contains the missing tokens, we can:');
  console.log('1. Use the decoder pattern (decimal → hex) on token_id');
  console.log('2. Extract condition_id from decoded token');
  console.log('3. Populate ctf_token_map with the missing mappings\n');
}

analyzeERC1155Sources().catch(console.error);
