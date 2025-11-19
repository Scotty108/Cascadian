require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'polymarket'
});

async function analyzeCoverage() {
  console.log('=== TOKEN MAPPING COVERAGE ANALYSIS ===\n');

  // Step 1: Understand asset_id format in clob_fills
  console.log('📋 STEP 1: Asset ID format analysis');
  console.log('─'.repeat(60));

  try {
    const formatResult = await client.query({
      query: `
        SELECT
          asset_id,
          toTypeName(asset_id) as type,
          length(asset_id) as len
        FROM clob_fills
        WHERE asset_id != ''
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const formats = await formatResult.json();
    console.log('Asset ID format:');
    formats.forEach(row => {
      console.log(`  Type: ${row.type}, Length: ${row.len}`);
      console.log(`  Value: ${row.asset_id}`);
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Step 2: Try different join approaches
  console.log('\n📋 STEP 2: Testing join approaches');
  console.log('─'.repeat(60));

  // Approach A: Direct string match (if both are strings)
  try {
    console.log('Approach A: Direct string match');
    const directResult = await client.query({
      query: `
        SELECT count() as matches
        FROM clob_fills f
        INNER JOIN ctf_token_map t ON f.asset_id = t.token_id
        WHERE f.asset_id != ''
      `,
      format: 'JSONEachRow'
    });
    const directMatches = await directResult.json();
    console.log(`  Direct matches: ${directMatches[0].matches}`);
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Approach B: Convert asset_id to hex string
  try {
    console.log('Approach B: Convert decimal asset_id to hex');
    const hexResult = await client.query({
      query: `
        SELECT count() as matches
        FROM clob_fills f
        INNER JOIN ctf_token_map t
          ON concat('0x', lower(hex(toUInt256OrZero(f.asset_id)))) = t.token_id
        WHERE f.asset_id != ''
          AND toUInt256OrZero(f.asset_id) > 0
      `,
      format: 'JSONEachRow'
    });
    const hexMatches = await hexResult.json();
    console.log(`  Hex conversion matches: ${hexMatches[0].matches}`);
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Approach C: Check if token_id is already decimal
  try {
    console.log('Approach C: Check token_id format consistency');
    const tokenFormatsResult = await client.query({
      query: `
        SELECT
          countIf(token_id LIKE '0x%') as hex_count,
          countIf(token_id NOT LIKE '0x%') as decimal_count,
          count() as total
        FROM ctf_token_map
      `,
      format: 'JSONEachRow'
    });
    const tokenFormats = await tokenFormatsResult.json();
    console.log('  Token ID formats in ctf_token_map:');
    console.log(`    Hex format (0x...): ${tokenFormats[0].hex_count}`);
    console.log(`    Decimal format: ${tokenFormats[0].decimal_count}`);
    console.log(`    Total: ${tokenFormats[0].total}`);
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Step 3: Calculate coverage with working join
  console.log('\n📋 STEP 3: Coverage with working join method');
  console.log('─'.repeat(60));

  try {
    const coverageResult = await client.query({
      query: `
        WITH fills_with_hex AS (
          SELECT
            asset_id,
            condition_id,
            side,
            size,
            CASE
              WHEN asset_id LIKE '0x%' THEN asset_id
              ELSE concat('0x', lower(hex(toUInt256OrZero(asset_id))))
            END as asset_id_hex
          FROM clob_fills
          WHERE asset_id != ''
        )
        SELECT
          count(f.asset_id) as total_fills,
          countIf(t.token_id IS NOT NULL) as mapped_fills,
          round(countIf(t.token_id IS NOT NULL) * 100.0 / count(f.asset_id), 2) as coverage_pct,
          round(sum(CASE WHEN t.token_id IS NOT NULL THEN f.size ELSE 0 END) * 100.0 / sum(f.size), 2) as volume_coverage_pct
        FROM fills_with_hex f
        LEFT JOIN ctf_token_map t ON f.asset_id_hex = t.token_id
      `,
      format: 'JSONEachRow'
    });
    const coverage = await coverageResult.json();
    console.log('Coverage statistics:');
    console.log(`  Total fills: ${coverage[0].total_fills}`);
    console.log(`  Mapped fills: ${coverage[0].mapped_fills}`);
    console.log(`  Coverage: ${coverage[0].coverage_pct}%`);
    console.log(`  Volume coverage: ${coverage[0].volume_coverage_pct}%`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Step 4: Sample successful mappings
  console.log('\n📋 STEP 4: Sample successful mappings');
  console.log('─'.repeat(60));

  try {
    const samplesResult = await client.query({
      query: `
        WITH fills_with_hex AS (
          SELECT
            asset_id,
            condition_id,
            side,
            size,
            price,
            CASE
              WHEN asset_id LIKE '0x%' THEN asset_id
              ELSE concat('0x', lower(hex(toUInt256OrZero(asset_id))))
            END as asset_id_hex
          FROM clob_fills
          WHERE asset_id != ''
          LIMIT 10000
        )
        SELECT
          f.asset_id as original_asset_id,
          f.asset_id_hex as converted_asset_id,
          f.condition_id,
          f.side,
          f.price,
          f.size,
          t.outcome_index,
          t.source
        FROM fills_with_hex f
        INNER JOIN ctf_token_map t ON f.asset_id_hex = t.token_id
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const samples = await samplesResult.json();
    console.log('Sample mappings:');
    samples.forEach((row, idx) => {
      console.log(`\n${idx + 1}. Original: ${row.original_asset_id}`);
      console.log(`   Converted: ${row.converted_asset_id}`);
      console.log(`   Condition: ${row.condition_id}`);
      console.log(`   Side: ${row.side}, Outcome Index: ${row.outcome_index}`);
      console.log(`   Price: ${row.price}, Size: ${row.size}`);
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Step 5: Analyze unmapped fills
  console.log('\n📋 STEP 5: Analyzing unmapped fills');
  console.log('─'.repeat(60));

  try {
    const unmappedResult = await client.query({
      query: `
        WITH fills_with_hex AS (
          SELECT
            asset_id,
            condition_id,
            side,
            size,
            CASE
              WHEN asset_id LIKE '0x%' THEN asset_id
              ELSE concat('0x', lower(hex(toUInt256OrZero(asset_id))))
            END as asset_id_hex
          FROM clob_fills
          WHERE asset_id != ''
          LIMIT 100000
        )
        SELECT
          f.asset_id,
          f.asset_id_hex,
          f.condition_id,
          count() as fill_count,
          sum(f.size) as total_size
        FROM fills_with_hex f
        LEFT JOIN ctf_token_map t ON f.asset_id_hex = t.token_id
        WHERE t.token_id IS NULL
        GROUP BY f.asset_id, f.asset_id_hex, f.condition_id
        ORDER BY total_size DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const unmapped = await unmappedResult.json();
    console.log('Top unmapped asset_ids by volume:');
    unmapped.forEach((row, idx) => {
      console.log(`\n${idx + 1}. Asset: ${row.asset_id_hex}`);
      console.log(`   Condition: ${row.condition_id}`);
      console.log(`   Fill count: ${row.fill_count}, Total size: ${row.total_size}`);
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Analysis complete!');
  console.log('='.repeat(60));

  await client.close();
}

analyzeCoverage().catch(console.error);
