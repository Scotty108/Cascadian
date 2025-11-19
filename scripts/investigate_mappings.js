require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'polymarket'
});

async function investigate() {
  console.log('=== INVESTIGATION: Token → Outcome Index Mappings ===\n');

  // Step 1: Verify ctf_token_map
  console.log('📋 STEP 1: Checking ctf_token_map');
  console.log('─'.repeat(60));

  try {
    const countResult = await client.query({
      query: 'SELECT count() as total FROM ctf_token_map',
      format: 'JSONEachRow'
    });
    const rows = await countResult.json();
    const total = rows[0] ? rows[0].total : 0;
    console.log(`Total rows in ctf_token_map: ${total}`);

    if (total > 0) {
      const sampleResult = await client.query({
        query: 'SELECT * FROM ctf_token_map LIMIT 10',
        format: 'JSONEachRow'
      });
      const samples = await sampleResult.json();
      console.log('Sample data:');
      console.log(JSON.stringify(samples, null, 2));
    } else {
      console.log('❌ Table is EMPTY\n');
    }
  } catch (e) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 2: Check token_dim
  console.log('\n📋 STEP 2: Checking token_dim');
  console.log('─'.repeat(60));

  try {
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE token_dim',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    console.log('Schema:');
    schema.forEach(col => console.log(`  - ${col.name}: ${col.type}`));

    const countResult = await client.query({
      query: 'SELECT count() as total FROM token_dim',
      format: 'JSONEachRow'
    });
    const count = await countResult.json();
    const total = count[0] ? count[0].total : 0;
    console.log(`\nTotal rows: ${total}`);

    if (total > 0) {
      const sampleResult = await client.query({
        query: 'SELECT * FROM token_dim LIMIT 5',
        format: 'JSONEachRow'
      });
      const samples = await sampleResult.json();
      console.log('\nSample data:');
      console.log(JSON.stringify(samples, null, 2));
    }
  } catch (e) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 3: Search for tables with mapping keywords
  console.log('\n📋 STEP 3: Finding tables with mapping keywords');
  console.log('─'.repeat(60));

  try {
    const tablesResult = await client.query({
      query: `
        SELECT name
        FROM system.tables
        WHERE database = 'polymarket'
          AND (name LIKE '%token%' OR name LIKE '%outcome%' OR name LIKE '%asset%' OR name LIKE '%map%')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const tables = await tablesResult.json();
    console.log('Tables found:');
    tables.forEach(t => console.log(`  - ${t.name}`));
  } catch (e) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 4: Check gamma_markets for token data
  console.log('\n📋 STEP 4: Checking gamma_markets for token/outcome data');
  console.log('─'.repeat(60));

  try {
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE gamma_markets',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    console.log('All fields in gamma_markets:');
    schema.forEach(col => console.log(`  - ${col.name}: ${col.type}`));

    // Check outcomes_json structure
    const outcomeResult = await client.query({
      query: `
        SELECT
          condition_id,
          outcomes_json,
          question
        FROM gamma_markets
        WHERE length(outcomes_json) > 0
        LIMIT 3
      `,
      format: 'JSONEachRow'
    });
    const outcomes = await outcomeResult.json();
    console.log('\nSample outcomes_json structures:');
    outcomes.forEach((row, idx) => {
      console.log(`\nMarket ${idx + 1}: ${row.question}`);
      console.log(`Condition ID: ${row.condition_id}`);
      try {
        const parsed = JSON.parse(row.outcomes_json);
        console.log('Parsed outcomes_json:', JSON.stringify(parsed, null, 2));
      } catch (e) {
        console.log('Raw outcomes_json:', row.outcomes_json);
      }
    });
  } catch (e) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 5: Check ERC1155 transfers
  console.log('\n📋 STEP 5: Checking erc1155_transfers structure');
  console.log('─'.repeat(60));

  try {
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE erc1155_transfers',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    console.log('Schema:');
    schema.forEach(col => console.log(`  - ${col.name}: ${col.type}`));

    const sampleResult = await client.query({
      query: `
        SELECT
          token_id,
          value,
          from_address,
          to_address,
          tx_hash
        FROM erc1155_transfers
        LIMIT 3
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json();
    console.log('\nSample transfers:');
    console.log(JSON.stringify(samples, null, 2));
  } catch (e) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 6: Check clob_fills for ALL fields
  console.log('\n📋 STEP 6: Full schema of clob_fills');
  console.log('─'.repeat(60));

  try {
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE clob_fills',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    console.log('ALL fields:');
    schema.forEach(col => console.log(`  - ${col.name}: ${col.type}`));

    // Sample a fill with all fields
    const sampleResult = await client.query({
      query: 'SELECT * FROM clob_fills LIMIT 1',
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json();
    console.log('\nSample fill (all fields):');
    console.log(JSON.stringify(samples[0], null, 2));
  } catch (e) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 7: Cross-reference asset_id
  console.log('\n📋 STEP 7: Cross-referencing sample asset_id');
  console.log('─'.repeat(60));

  const sampleAssetId = '31665866084346327246895108523480458446602223474393525150982234884217167962424';
  console.log(`Searching for asset_id: ${sampleAssetId}`);

  // Check if it appears in erc1155_transfers as token_id
  try {
    const transferResult = await client.query({
      query: `
        SELECT count() as matches
        FROM erc1155_transfers
        WHERE token_id = '${sampleAssetId}'
      `,
      format: 'JSONEachRow'
    });
    const matches = await transferResult.json();
    const matchCount = matches[0] ? matches[0].matches : 0;
    console.log(`\nMatches in erc1155_transfers.token_id: ${matchCount}`);

    if (matchCount > 0) {
      const sampleResult = await client.query({
        query: `
          SELECT *
          FROM erc1155_transfers
          WHERE token_id = '${sampleAssetId}'
          LIMIT 2
        `,
        format: 'JSONEachRow'
      });
      const samples = await sampleResult.json();
      console.log('Sample matching transfers:');
      console.log(JSON.stringify(samples, null, 2));
    }
  } catch (e) {
    console.log(`Error checking erc1155_transfers: ${e.message}`);
  }

  // Check token_dim
  try {
    const tokenResult = await client.query({
      query: `
        SELECT count() as matches
        FROM token_dim
        WHERE token_id = '${sampleAssetId}'
      `,
      format: 'JSONEachRow'
    });
    const matches = await tokenResult.json();
    const matchCount = matches[0] ? matches[0].matches : 0;
    console.log(`Matches in token_dim.token_id: ${matchCount}`);
  } catch (e) {
    console.log(`Error checking token_dim: ${e.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Investigation complete!');
  console.log('='.repeat(60));

  await client.close();
}

investigate().catch(console.error);
