import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function fixCtfTokenMap() {
  console.log('\n🔧 FIX CTF_TOKEN_MAP FROM GAMMA_MARKETS (DIRECT)\n');
  console.log('='.repeat(80));
  
  // Step 1: Test outcome_index calculation
  console.log('\n1️⃣ Testing outcome_index calculation:\n');
  
  const testQuery = `
    SELECT
      token_id,
      outcome,
      outcomes_json,
      indexOf(JSONExtract(outcomes_json, 'Array(String)'), outcome) - 1 as outcome_index
    FROM gamma_markets
    WHERE outcomes_json != '[]'
    LIMIT 5
  `;
  
  const testResult = await clickhouse.query({ query: testQuery, format: 'JSONEachRow' });
  const testData = await testResult.json();
  
  console.log('Sample outcome_index calculations:');
  console.table(testData);
  
  // Step 2: Validation check
  console.log('\n2️⃣ Validation check:\n');
  
  const validationQuery = `
    WITH mapped AS (
      SELECT
        token_id,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        indexOf(JSONExtract(outcomes_json, 'Array(String)'), outcome) - 1 as outcome_index
      FROM gamma_markets
      WHERE token_id != '' AND condition_id != ''
    )
    SELECT
      count() as total_mappings,
      uniq(token_id) as unique_tokens,
      uniq(condition_id_norm) as unique_conditions,
      countIf(length(condition_id_norm) = 64) as valid_condition_format,
      countIf(outcome_index >= 0 AND outcome_index <= 255) as valid_outcome_idx,
      round(countIf(length(condition_id_norm) = 64) / count() * 100, 2) as validation_pct
    FROM mapped
  `;
  
  const validationResult = await clickhouse.query({ query: validationQuery, format: 'JSONEachRow' });
  const validation = await validationResult.json();
  
  console.log('Validation results:');
  console.table(validation);
  
  const validationPct = parseFloat(validation[0].validation_pct);
  
  if (validationPct < 95) {
    console.log(`\n❌ VALIDATION FAILED: Only ${validationPct}% valid`);
    return;
  }
  
  console.log(`\n✅ VALIDATION PASSED: ${validationPct}% valid`);
  
  // Step 3: Create backup and replace
  console.log('\n3️⃣ Creating backup and replacing ctf_token_map:\n');
  
  const backupName = 'ctf_token_map_backup_' + new Date().toISOString().split('T')[0].replace(/-/g, '');
  
  console.log('  Creating backup: ' + backupName);
  await clickhouse.query({ query: 'CREATE TABLE ' + backupName + ' AS ctf_token_map' });
  await clickhouse.query({ query: 'INSERT INTO ' + backupName + ' SELECT * FROM ctf_token_map' });
  console.log('  ✅ Backup created');
  
  console.log('  Truncating ctf_token_map...');
  await clickhouse.query({ query: 'TRUNCATE TABLE ctf_token_map' });
  console.log('  ✅ Truncated');
  
  console.log('  Populating with correct mappings...');
  const populateQuery = `
    INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
    SELECT
      token_id,
      lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
      indexOf(JSONExtract(outcomes_json, 'Array(String)'), outcome) - 1 as outcome_index,
      'gamma_markets_direct' as source
    FROM gamma_markets
    WHERE token_id != '' 
      AND condition_id != ''
      AND length(lower(replaceAll(condition_id, '0x', ''))) = 64
  `;
  
  await clickhouse.query({ query: populateQuery });
  console.log('  ✅ Population complete');
  
  // Step 4: Verify new state
  console.log('\n4️⃣ Verifying new state:\n');
  
  const verifyQuery = `
    SELECT
      count() as total_rows,
      uniq(token_id) as unique_tokens,
      uniq(condition_id_norm) as unique_conditions,
      groupArray(source)[1] as source
    FROM ctf_token_map
  `;
  
  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const verify = await verifyResult.json();
  
  console.log('New ctf_token_map state:');
  console.table(verify);
  
  // Step 5: Coverage analysis
  console.log('\n5️⃣ Coverage analysis:\n');
  
  const coverageQuery = `
    SELECT
      count() as total_fills,
      countIf(asset_id IN (SELECT token_id FROM ctf_token_map)) as mapped_fills,
      round(mapped_fills / total_fills * 100, 2) as coverage_pct
    FROM clob_fills
    WHERE asset_id != ''
  `;
  
  const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverage = await coverageResult.json();
  
  console.log('Fill coverage:');
  console.table(coverage);
  
  console.log('\n' + '='.repeat(80));
  console.log('\n✅ CTF_TOKEN_MAP FIX COMPLETE\n');
  console.log('Next steps:');
  console.log('1. Run P&L validation: npx tsx scripts/validate-corrected-pnl-comprehensive-fixed.ts');
  console.log('2. Verify <2% variance target is met');
  console.log('3. If validation passes, Bug #4 is RESOLVED\n');
}

fixCtfTokenMap().catch(console.error);
