import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function testValidation() {
  console.log('\n🔍 Testing gamma metadata + clob_fills approach\n');
  
  const query = `
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
      countIf(outcome_index >= 0 AND outcome_index <= 255) as valid_outcome_idx,
      round(countIf(length(condition_id_norm) = 64) / count() * 100, 2) as validation_pct
    FROM mapped
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  
  console.log('Validation Results:');
  console.table(data);
  
  const validationPct = parseFloat(data[0].validation_pct);
  
  if (validationPct >= 95) {
    console.log(`\n✅ VALIDATION PASSED: ${validationPct}% success rate`);
    console.log('Ready to proceed with production population');
  } else {
    console.log(`\n❌ VALIDATION FAILED: Only ${validationPct}% success rate`);
    console.log('Need >95% to proceed');
  }
}

testValidation().catch(console.error);
