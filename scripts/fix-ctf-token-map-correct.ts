import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

/**
 * Fix ctf_token_map with CORRECT condition_id values
 *
 * Strategy:
 * 1. Extract token_id + outcome_index from gamma_markets.metadata.clobTokenIds
 * 2. Get ACTUAL condition_id from clob_fills (trades have correct values)
 * 3. Test on 1,000 tokens first, then bulk populate if validation passes
 *
 * CRITICAL: This fixes the bug where we used gamma_markets.condition_id (parent market)
 * instead of the individual token's condition_id from actual trades.
 */

const TEST_MODE = process.argv.includes('--test');
const PRODUCTION_MODE = process.argv.includes('--production');

async function fixCtfTokenMap() {
  console.log('\n🔧 FIX CTF_TOKEN_MAP WITH CORRECT CONDITION_IDS\n');
  console.log('='.repeat(80));

  if (!TEST_MODE && !PRODUCTION_MODE) {
    console.log('❌ ERROR: Must specify --test or --production mode\n');
    console.log('Usage:');
    console.log('  npx tsx scripts/fix-ctf-token-map-correct.ts --test       (test on 1,000 tokens)');
    console.log('  npx tsx scripts/fix-ctf-token-map-correct.ts --production (full population)\n');
    return;
  }

  const mode = TEST_MODE ? 'TEST' : 'PRODUCTION';
  console.log(`MODE: ${mode}`);
  console.log('');

  // Step 1: Show current state
  console.log('1️⃣ Current ctf_token_map state:\n');

  const currentStateQuery = `
    SELECT
      count() as total_rows,
      uniq(token_id) as unique_tokens,
      uniq(condition_id_norm) as unique_conditions,
      groupArray(source) as sources
    FROM ctf_token_map
  `;

  const currentResult = await clickhouse.query({
    query: currentStateQuery,
    format: 'JSONEachRow'
  });
  const current = await currentResult.json();

  console.log(`  Total rows: ${parseInt(current[0].total_rows).toLocaleString()}`);
  console.log(`  Unique tokens: ${parseInt(current[0].unique_tokens).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(current[0].unique_conditions).toLocaleString()}`);
  console.log(`  Sources: ${current[0].sources.join(', ')}`);

  // Step 2: Extract tokens from gamma_markets.metadata
  console.log('\n2️⃣ Extracting tokens from gamma_markets.metadata.clobTokenIds:\n');

  const extractQuery = `
    WITH extracted AS (
      SELECT
        gm.id as market_id,
        gm.question,
        replaceAll(replaceAll(
          arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
          '"', ''), '\\\\', '') as token_id,
        arrayPosition(
          JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds')),
          concat('"', replaceAll(replaceAll(
            arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
            '"', ''), '\\\\', ''), '"')
        ) - 1 as outcome_index
      FROM gamma_markets gm
      WHERE JSONExtractString(gm.metadata, 'clobTokenIds') != ''
        AND JSONExtractString(gm.metadata, 'clobTokenIds') != '[]'
    )
    SELECT
      count() as total_extracted,
      uniq(token_id) as unique_tokens,
      min(outcome_index) as min_outcome_idx,
      max(outcome_index) as max_outcome_idx
    FROM extracted
  `;

  const extractResult = await clickhouse.query({
    query: extractQuery,
    format: 'JSONEachRow'
  });
  const extracted = await extractResult.json();

  console.log(`  Tokens extracted: ${parseInt(extracted[0].total_extracted).toLocaleString()}`);
  console.log(`  Unique tokens: ${parseInt(extracted[0].unique_tokens).toLocaleString()}`);
  console.log(`  Outcome index range: ${extracted[0].min_outcome_idx} - ${extracted[0].max_outcome_idx}`);

  // Step 3: Match with clob_fills to get CORRECT condition_id
  console.log('\n3️⃣ Matching with clob_fills to get correct condition_id:\n');

  const matchQuery = `
    WITH extracted AS (
      SELECT
        replaceAll(replaceAll(
          arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
          '"', ''), '\\\\', '') as token_id,
        arrayPosition(
          JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds')),
          concat('"', replaceAll(replaceAll(
            arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
            '"', ''), '\\\\', ''), '"')
        ) - 1 as outcome_index
      FROM gamma_markets gm
      WHERE JSONExtractString(gm.metadata, 'clobTokenIds') != ''
    )
    SELECT
      count() as total_matches,
      uniq(e.token_id) as unique_tokens_matched,
      uniq(cf.condition_id) as unique_conditions_found
    FROM extracted e
    INNER JOIN clob_fills cf ON e.token_id = cf.asset_id
    WHERE cf.condition_id != ''
  `;

  const matchResult = await clickhouse.query({
    query: matchQuery,
    format: 'JSONEachRow'
  });
  const matched = await matchResult.json();

  console.log(`  Total matches: ${parseInt(matched[0].total_matches).toLocaleString()}`);
  console.log(`  Unique tokens matched: ${parseInt(matched[0].unique_tokens_matched).toLocaleString()}`);
  console.log(`  Unique conditions found: ${parseInt(matched[0].unique_conditions_found).toLocaleString()}`);

  // Step 4: Show sample of what we'll create
  console.log('\n4️⃣ Sample of corrected mappings:\n');

  const sampleQuery = `
    WITH extracted AS (
      SELECT
        replaceAll(replaceAll(
          arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
          '"', ''), '\\\\', '') as token_id,
        arrayPosition(
          JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds')),
          concat('"', replaceAll(replaceAll(
            arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
            '"', ''), '\\\\', ''), '"')
        ) - 1 as outcome_index
      FROM gamma_markets gm
      WHERE JSONExtractString(gm.metadata, 'clobTokenIds') != ''
      LIMIT 10
    )
    SELECT DISTINCT
      e.token_id,
      lower(replaceAll(cf.condition_id, '0x', '')) as condition_id_norm,
      e.outcome_index
    FROM extracted e
    INNER JOIN clob_fills cf ON e.token_id = cf.asset_id
    WHERE cf.condition_id != ''
    LIMIT 5
  `;

  const sampleResult = await clickhouse.query({
    query: sampleQuery,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json();

  console.table(samples);

  // Step 5: Validation check
  console.log('\n5️⃣ Validation: Check if condition_ids match fill data:\n');

  const validationQuery = `
    WITH extracted AS (
      SELECT
        replaceAll(replaceAll(
          arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
          '"', ''), '\\\\', '') as token_id,
        arrayPosition(
          JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds')),
          concat('"', replaceAll(replaceAll(
            arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
            '"', ''), '\\\\', ''), '"')
        ) - 1 as outcome_index
      FROM gamma_markets gm
      WHERE JSONExtractString(gm.metadata, 'clobTokenIds') != ''
      LIMIT 1000
    ),
    mapped AS (
      SELECT DISTINCT
        e.token_id,
        lower(replaceAll(cf.condition_id, '0x', '')) as condition_id_norm,
        e.outcome_index
      FROM extracted e
      INNER JOIN clob_fills cf ON e.token_id = cf.asset_id
      WHERE cf.condition_id != ''
    )
    SELECT
      count() as total_test_mappings,
      uniq(token_id) as unique_tokens,
      uniq(condition_id_norm) as unique_conditions,
      countIf(length(condition_id_norm) = 64) as valid_condition_format,
      countIf(outcome_index >= 0 AND outcome_index <= 255) as valid_outcome_idx
    FROM mapped
  `;

  const validationResult = await clickhouse.query({
    query: validationQuery,
    format: 'JSONEachRow'
  });
  const validation = await validationResult.json();

  console.log(`  Test mappings created: ${validation[0].total_test_mappings}`);
  console.log(`  Unique tokens: ${validation[0].unique_tokens}`);
  console.log(`  Unique conditions: ${validation[0].unique_conditions}`);
  console.log(`  Valid condition_id format (64 chars): ${validation[0].valid_condition_format}`);
  console.log(`  Valid outcome_index (0-255): ${validation[0].valid_outcome_idx}`);

  const validationRate = (parseInt(validation[0].valid_condition_format) / parseInt(validation[0].total_test_mappings) * 100).toFixed(2);
  console.log(`  Validation rate: ${validationRate}%`);

  if (parseFloat(validationRate) < 95) {
    console.log('\n❌ VALIDATION FAILED: Less than 95% of mappings are valid');
    console.log('   Cannot proceed with production population');
    return;
  }

  console.log('\n✅ VALIDATION PASSED: Ready to populate ctf_token_map');

  if (TEST_MODE) {
    console.log('\n📊 TEST MODE COMPLETE - Review results above');
    console.log('If validation passed, run with --production to apply changes\n');
    return;
  }

  // PRODUCTION MODE: Apply changes
  console.log('\n6️⃣ PRODUCTION: Backing up and replacing ctf_token_map:\n');

  // Backup existing table
  console.log('  Creating backup...');
  const backupName = `ctf_token_map_backup_${new Date().toISOString().split('T')[0].replace(/-/g, '')}`;

  await clickhouse.query({
    query: `CREATE TABLE ${backupName} AS ctf_token_map`,
    format: 'JSONEachRow'
  });

  await clickhouse.query({
    query: `INSERT INTO ${backupName} SELECT * FROM ctf_token_map`,
    format: 'JSONEachRow'
  });

  console.log(`  ✅ Backup created: ${backupName}`);

  // Clear existing data
  console.log('  Truncating ctf_token_map...');
  await clickhouse.query({
    query: 'TRUNCATE TABLE ctf_token_map',
    format: 'JSONEachRow'
  });

  // Populate with corrected mappings
  console.log('  Populating with corrected mappings...');

  const populateQuery = `
    INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
    WITH extracted AS (
      SELECT
        replaceAll(replaceAll(
          arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
          '"', ''), '\\\\', '') as token_id,
        arrayPosition(
          JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds')),
          concat('"', replaceAll(replaceAll(
            arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
            '"', ''), '\\\\', ''), '"')
        ) - 1 as outcome_index
      FROM gamma_markets gm
      WHERE JSONExtractString(gm.metadata, 'clobTokenIds') != ''
        AND JSONExtractString(gm.metadata, 'clobTokenIds') != '[]'
    )
    SELECT DISTINCT
      e.token_id,
      lower(replaceAll(cf.condition_id, '0x', '')) as condition_id_norm,
      e.outcome_index,
      'gamma_metadata_with_fill_cid' as source
    FROM extracted e
    INNER JOIN clob_fills cf ON e.token_id = cf.asset_id
    WHERE cf.condition_id != ''
      AND length(lower(replaceAll(cf.condition_id, '0x', ''))) = 64
  `;

  await clickhouse.query({
    query: populateQuery,
    format: 'JSONEachRow'
  });

  console.log('  ✅ Population complete');

  // Step 7: Verify new state
  console.log('\n7️⃣ Verifying new ctf_token_map state:\n');

  const newStateResult = await clickhouse.query({
    query: currentStateQuery,
    format: 'JSONEachRow'
  });
  const newState = await newStateResult.json();

  console.log(`  Total rows: ${parseInt(newState[0].total_rows).toLocaleString()}`);
  console.log(`  Unique tokens: ${parseInt(newState[0].unique_tokens).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(newState[0].unique_conditions).toLocaleString()}`);
  console.log(`  Sources: ${newState[0].sources.join(', ')}`);

  // Step 8: Calculate coverage
  console.log('\n8️⃣ Coverage analysis:\n');

  const coverageQuery = `
    SELECT
      count() as total_fills,
      countIf(asset_id IN (SELECT token_id FROM ctf_token_map)) as mapped_fills,
      round(mapped_fills / total_fills * 100, 2) as coverage_pct,
      uniq(asset_id) as total_unique_assets,
      uniqIf(asset_id, asset_id IN (SELECT token_id FROM ctf_token_map)) as mapped_assets,
      round(mapped_assets / total_unique_assets * 100, 2) as asset_coverage_pct
    FROM clob_fills
    WHERE asset_id != ''
  `;

  const coverageResult = await clickhouse.query({
    query: coverageQuery,
    format: 'JSONEachRow'
  });
  const coverage = await coverageResult.json();

  console.log(`  Total fills: ${parseInt(coverage[0].total_fills).toLocaleString()}`);
  console.log(`  Mapped fills: ${parseInt(coverage[0].mapped_fills).toLocaleString()}`);
  console.log(`  Fill coverage: ${coverage[0].coverage_pct}%`);
  console.log('');
  console.log(`  Unique assets: ${parseInt(coverage[0].total_unique_assets).toLocaleString()}`);
  console.log(`  Mapped assets: ${parseInt(coverage[0].mapped_assets).toLocaleString()}`);
  console.log(`  Asset coverage: ${coverage[0].asset_coverage_pct}%`);

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ CTF_TOKEN_MAP FIX COMPLETE\n');
  console.log('Next steps:');
  console.log('1. Run P&L validation: npx tsx scripts/validate-corrected-pnl-comprehensive-fixed.ts');
  console.log('2. Verify <2% variance target is met');
  console.log('3. If validation passes, Bug #4 is RESOLVED\n');
}

fixCtfTokenMap().catch(console.error);
