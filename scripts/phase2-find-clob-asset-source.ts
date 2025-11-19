import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function findClobAssetSource() {
  console.log('\n🔍 FINDING SOURCE FOR CLOB_FILLS ASSET_IDS\n');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Check if clob_fills.asset_id exists in ctf_token_map (exact match):\n');

  const exactMatchQuery = `
    SELECT
      countIf(cf.asset_id IN (
        SELECT token_id FROM ctf_token_map
      )) as exact_matches,
      count() as total_fills,
      round(exact_matches / total_fills * 100, 2) as match_pct
    FROM clob_fills cf
    WHERE cf.asset_id != ''
  `;

  const exactResult = await clickhouse.query({
    query: exactMatchQuery,
    format: 'JSONEachRow'
  });
  const exact = await exactResult.json();

  console.log(`   Exact matches: ${parseInt(exact[0].exact_matches).toLocaleString()}`);
  console.log(`   Match rate: ${exact[0].match_pct}%`);

  console.log('\n2️⃣ Check if ctf_token_map has BOTH hex and decimal formats:\n');

  const formatCheckQuery = `
    SELECT
      countIf(token_id LIKE '0x%') as hex_format,
      countIf(token_id REGEXP '^[0-9]+\$') as decimal_format,
      count() as total_tokens
    FROM ctf_token_map
  `;

  const formatResult = await clickhouse.query({
    query: formatCheckQuery,
    format: 'JSONEachRow'
  });
  const format = await formatResult.json();

  console.log(`   Hex format (0x...): ${format[0].hex_format}`);
  console.log(`   Decimal format: ${format[0].decimal_format}`);
  console.log(`   Total: ${format[0].total_tokens}`);

  console.log('\n3️⃣ Sample comparison (clob_fills vs ctf_token_map):\n');

  const comparisonQuery = `
    SELECT
      cf.asset_id as clob_asset_id,
      c.token_id as ctf_token_id,
      c.condition_id_norm
    FROM clob_fills cf
    INNER JOIN ctf_token_map c ON cf.asset_id = c.token_id
    WHERE cf.asset_id != ''
    LIMIT 5
  `;

  try {
    const comparisonResult = await clickhouse.query({
      query: comparisonQuery,
      format: 'JSONEachRow'
    });
    const comparison = await comparisonResult.json();

    if (comparison.length > 0) {
      console.log('   ✅ Direct matches found!\n');
      console.table(comparison);
    } else {
      console.log('   ❌ No direct matches');
    }
  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n4️⃣ Find unmapped asset_ids in clob_fills:\n');

  const unmappedQuery = `
    SELECT DISTINCT cf.asset_id
    FROM clob_fills cf
    LEFT JOIN ctf_token_map c ON cf.asset_id = c.token_id
    WHERE cf.asset_id != ''
      AND c.token_id IS NULL
    LIMIT 10
  `;

  const unmappedResult = await clickhouse.query({
    query: unmappedQuery,
    format: 'JSONEachRow'
  });
  const unmapped = await unmappedResult.json();

  console.log('   Sample unmapped asset_ids:');
  unmapped.forEach((row: any, i: number) => {
    console.log(`   ${i+1}. ${row.asset_id}`);
  });

  console.log('\n5️⃣ Try decoding unmapped asset_ids (decimal → hex):\n');

  const decodeUnmappedQuery = `
    WITH unmapped_assets AS (
      SELECT DISTINCT cf.asset_id
      FROM clob_fills cf
      LEFT JOIN ctf_token_map c ON cf.asset_id = c.token_id
      WHERE cf.asset_id != ''
        AND c.token_id IS NULL
      LIMIT 100
    )
    SELECT
      asset_id as original_decimal,
      lower(hex(toUInt256OrZero(asset_id))) as decoded_to_hex,
      decoded_to_hex IN (
        SELECT DISTINCT condition_id_norm FROM canonical_condition
      ) as exists_in_canonical
    FROM unmapped_assets
    LIMIT 10
  `;

  try {
    const decodeResult = await clickhouse.query({
      query: decodeUnmappedQuery,
      format: 'JSONEachRow'
    });
    const decoded = await decodeResult.json();

    console.log('   Decoded samples:');
    console.table(decoded);

    const matchCount = decoded.filter((r: any) => r.exists_in_canonical === 1 || r.exists_in_canonical === '1').length;
    console.log(`\\n   Match rate: ${matchCount}/10 (${matchCount * 10}%)`);

  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 STRATEGY:\n');
  console.log('If unmapped asset_ids decode to valid condition_ids:');
  console.log('1. Create staging table with decoded mappings');
  console.log('2. Add (asset_id_decimal, condition_id_hex, outcome_index)');
  console.log('3. Merge into ctf_token_map\n');
}

findClobAssetSource().catch(console.error);
