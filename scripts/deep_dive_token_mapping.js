require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'polymarket'
});

async function deepDive() {
  console.log('=== DEEP DIVE: Token Mapping Data Quality ===\n');

  // Check 1: Are token_ids stored as hex strings or decimals?
  console.log('📋 CHECK 1: Token ID format in ctf_token_map');
  console.log('─'.repeat(60));

  try {
    const sampleResult = await client.query({
      query: `
        SELECT
          token_id,
          outcome_index,
          condition_id_norm,
          market_id,
          source
        FROM ctf_token_map
        WHERE length(condition_id_norm) > 0
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json();
    console.log('Sample rows with condition_id:');
    console.log(JSON.stringify(samples, null, 2));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check 2: How many rows have empty condition_id_norm?
  console.log('\n📋 CHECK 2: Data completeness analysis');
  console.log('─'.repeat(60));

  try {
    const statsResult = await client.query({
      query: `
        SELECT
          countIf(length(condition_id_norm) > 0) as with_condition,
          countIf(length(condition_id_norm) = 0) as without_condition,
          countIf(length(market_id) > 0) as with_market,
          count() as total
        FROM ctf_token_map
      `,
      format: 'JSONEachRow'
    });
    const stats = await statsResult.json();
    console.log('Data completeness:');
    console.log(JSON.stringify(stats[0], null, 2));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check 3: Can we convert decimal asset_id to hex to match?
  console.log('\n📋 CHECK 3: Converting clob_fills asset_id to hex format');
  console.log('─'.repeat(60));

  try {
    const conversionResult = await client.query({
      query: `
        SELECT
          asset_id,
          concat('0x', lower(hex(toUInt256(asset_id)))) as asset_id_hex,
          condition_id,
          side,
          size
        FROM clob_fills
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const conversions = await conversionResult.json();
    console.log('Asset ID conversions:');
    conversions.forEach(row => {
      console.log(`Decimal: ${row.asset_id}`);
      console.log(`Hex:     ${row.asset_id_hex}`);
      console.log(`Condition: ${row.condition_id}`);
      console.log('---');
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check 4: Do converted asset_ids match token_ids in ctf_token_map?
  console.log('\n📋 CHECK 4: Testing join between clob_fills and ctf_token_map');
  console.log('─'.repeat(60));

  try {
    const joinResult = await client.query({
      query: `
        SELECT
          f.asset_id,
          concat('0x', lower(hex(toUInt256(f.asset_id)))) as asset_id_hex,
          f.condition_id,
          f.side,
          t.outcome_index,
          t.token_id
        FROM clob_fills f
        INNER JOIN ctf_token_map t
          ON concat('0x', lower(hex(toUInt256(f.asset_id)))) = t.token_id
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const joins = await joinResult.json();
    console.log(`Found ${joins.length} matching rows!`);
    console.log('Sample matches:');
    console.log(JSON.stringify(joins, null, 2));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check 5: What's the coverage of this join?
  console.log('\n📋 CHECK 5: Coverage analysis');
  console.log('─'.repeat(60));

  try {
    const coverageResult = await client.query({
      query: `
        SELECT
          count() as total_fills,
          countIf(t.token_id IS NOT NULL) as mapped_fills,
          round(countIf(t.token_id IS NOT NULL) * 100.0 / count(), 2) as coverage_pct
        FROM clob_fills f
        LEFT JOIN ctf_token_map t
          ON concat('0x', lower(hex(toUInt256(f.asset_id)))) = t.token_id
      `,
      format: 'JSONEachRow'
    });
    const coverage = await coverageResult.json();
    console.log('Coverage stats:');
    console.log(JSON.stringify(coverage[0], null, 2));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check 6: Check if token_dim has better data
  console.log('\n📋 CHECK 6: Comparing token_dim vs ctf_token_map');
  console.log('─'.repeat(60));

  try {
    const dimStatsResult = await client.query({
      query: `
        SELECT
          countIf(length(condition_id_norm) > 0) as with_condition,
          countIf(length(condition_id_norm) = 0) as without_condition,
          count() as total
        FROM token_dim
      `,
      format: 'JSONEachRow'
    });
    const dimStats = await dimStatsResult.json();
    console.log('token_dim completeness:');
    console.log(JSON.stringify(dimStats[0], null, 2));

    // Try joining with token_dim
    const dimJoinResult = await client.query({
      query: `
        SELECT
          f.asset_id,
          concat('0x', lower(hex(toUInt256(f.asset_id)))) as asset_id_hex,
          f.condition_id,
          f.side,
          t.outcome_idx,
          t.token_id
        FROM clob_fills f
        INNER JOIN token_dim t
          ON concat('0x', lower(hex(toUInt256(f.asset_id)))) = t.token_id
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const dimJoins = await dimJoinResult.json();
    console.log(`\ntoken_dim join: Found ${dimJoins.length} matching rows!`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check 7: Analyze outcome_index distribution
  console.log('\n📋 CHECK 7: Outcome index distribution');
  console.log('─'.repeat(60));

  try {
    const distResult = await client.query({
      query: `
        SELECT
          outcome_index,
          count() as count
        FROM ctf_token_map
        GROUP BY outcome_index
        ORDER BY outcome_index
      `,
      format: 'JSONEachRow'
    });
    const dist = await distResult.json();
    console.log('Outcome index distribution:');
    dist.forEach(row => console.log(`  Index ${row.outcome_index}: ${row.count} tokens`));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Deep dive complete!');
  console.log('='.repeat(60));

  await client.close();
}

deepDive().catch(console.error);
