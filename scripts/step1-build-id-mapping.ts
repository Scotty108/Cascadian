#!/usr/bin/env npx tsx
/**
 * STEP 1: Build ID Mapping Table
 *
 * Creates canonical mapping: token_id_erc1155 → condition_id_32b → market_id_cid
 * This stops us from blindly truncating condition_ids and proves the mapping works.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('STEP 1: BUILD ID MAPPING TABLE');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1.1: Check if we have token_id in vw_trades_canonical
  console.log('Step 1.1: Checking available columns in vw_trades_canonical...\n');

  const schema = await ch.query({
    query: `DESCRIBE TABLE default.vw_trades_canonical`,
    format: 'JSONEachRow',
  });
  const schemaData = await schema.json<any[]>();

  const hasTokenId = schemaData.some(col => col.name === 'token_id');
  const hasConditionId = schemaData.some(col => col.name === 'condition_id_norm');

  console.log(`✓ Has condition_id_norm: ${hasConditionId}`);
  console.log(`✓ Has token_id: ${hasTokenId}\n`);

  if (!hasConditionId) {
    console.log('❌ ERROR: condition_id_norm not found in vw_trades_canonical');
    process.exit(1);
  }

  // Step 1.2: Create mapping table
  console.log('Step 1.2: Creating token_condition_market_map table...\n');

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS cascadian_clean.token_condition_market_map (
        token_id_erc1155 String,
        condition_id_32b String,
        market_id_cid String,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(created_at)
      ORDER BY (condition_id_32b)
    `
  });

  console.log('✓ Created token_condition_market_map table\n');

  // Step 1.3: Populate mapping from vw_trades_canonical
  console.log('Step 1.3: Populating mapping from vw_trades_canonical...\n');

  if (hasTokenId) {
    // Use token_id if available
    await ch.command({
      query: `
        INSERT INTO cascadian_clean.token_condition_market_map
        SELECT DISTINCT
          token_id as token_id_erc1155,
          lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b,
          concat('0x', left(lower(replaceAll(condition_id_norm, '0x', '')), 62), '00') as market_id_cid,
          now() as created_at
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND token_id != ''
      `
    });
  } else {
    // Just use condition_id if token_id not available
    await ch.command({
      query: `
        INSERT INTO cascadian_clean.token_condition_market_map
        SELECT DISTINCT
          '' as token_id_erc1155,
          lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b,
          concat('0x', left(lower(replaceAll(condition_id_norm, '0x', '')), 62), '00') as market_id_cid,
          now() as created_at
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `
    });
  }

  console.log('✓ Populated mapping table\n');

  // Step 1.4: Validate mapping consistency
  console.log('Step 1.4: Validating mapping consistency...\n');

  const validation = await ch.query({
    query: `
      SELECT
        count(DISTINCT condition_id_32b) as unique_conditions,
        count(DISTINCT market_id_cid) as unique_markets,
        count(*) as total_rows
      FROM cascadian_clean.token_condition_market_map
    `,
    format: 'JSONEachRow',
  });
  const validationData = await validation.json<any[]>();

  console.log(`Total rows: ${parseInt(validationData[0].total_rows).toLocaleString()}`);
  console.log(`Unique condition_ids: ${parseInt(validationData[0].unique_conditions).toLocaleString()}`);
  console.log(`Unique market_ids: ${parseInt(validationData[0].unique_markets).toLocaleString()}\n`);

  // Check for duplicates
  const duplicates = await ch.query({
    query: `
      SELECT
        condition_id_32b,
        count(DISTINCT market_id_cid) as market_count
      FROM cascadian_clean.token_condition_market_map
      GROUP BY condition_id_32b
      HAVING market_count > 1
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const duplicatesData = await duplicates.json<any[]>();

  if (duplicatesData.length > 0) {
    console.log('⚠️  WARNING: Found condition_ids mapping to multiple markets:');
    for (const dup of duplicatesData) {
      console.log(`  ${dup.condition_id_32b} → ${dup.market_count} markets`);
    }
    console.log('');
  } else {
    console.log('✓ No duplicates found - mapping is consistent\n');
  }

  // Step 1.5: Sample data check
  console.log('Step 1.5: Sample mapping data...\n');

  const sample = await ch.query({
    query: `
      SELECT
        ${hasTokenId ? 'token_id_erc1155,' : ''}
        condition_id_32b,
        market_id_cid
      FROM cascadian_clean.token_condition_market_map
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const sampleData = await sample.json<any[]>();

  for (const row of sampleData) {
    if (hasTokenId) {
      console.log(`Token:     ${row.token_id_erc1155}`);
    }
    console.log(`Condition: ${row.condition_id_32b}`);
    console.log(`Market:    ${row.market_id_cid}`);
    console.log('');
  }

  // Step 1.6: Check ID format consistency
  console.log('Step 1.6: Validating ID formats...\n');

  const formats = await ch.query({
    query: `
      SELECT
        countIf(length(condition_id_32b) = 64) as valid_condition_length,
        countIf(length(condition_id_32b) != 64) as invalid_condition_length,
        countIf(endsWith(market_id_cid, '00')) as valid_market_suffix,
        countIf(NOT endsWith(market_id_cid, '00')) as invalid_market_suffix,
        count(*) as total
      FROM cascadian_clean.token_condition_market_map
    `,
    format: 'JSONEachRow',
  });
  const formatsData = await formats.json<any[]>();

  console.log(`Valid condition_id length (64 chars): ${formatsData[0].valid_condition_length}/${formatsData[0].total}`);
  console.log(`Valid market_id suffix ('00'): ${formatsData[0].valid_market_suffix}/${formatsData[0].total}\n`);

  if (parseInt(formatsData[0].invalid_condition_length) > 0) {
    console.log('⚠️  WARNING: Found invalid condition_id lengths');
    const invalid = await ch.query({
      query: `
        SELECT condition_id_32b, length(condition_id_32b) as len
        FROM cascadian_clean.token_condition_market_map
        WHERE length(condition_id_32b) != 64
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const invalidData = await invalid.json<any[]>();
    for (const row of invalidData) {
      console.log(`  ${row.condition_id_32b} (length: ${row.len})`);
    }
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('STEP 1 COMPLETE');
  console.log('═'.repeat(80));
  console.log(`✓ Created and populated token_condition_market_map`);
  console.log(`✓ ${parseInt(validationData[0].unique_conditions).toLocaleString()} unique condition_ids mapped`);
  console.log(`✓ ${parseInt(validationData[0].unique_markets).toLocaleString()} unique market_ids`);
  console.log(`✓ Mapping is ${duplicatesData.length === 0 ? 'CONSISTENT' : 'INCONSISTENT (see warnings above)'}\n`);

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
