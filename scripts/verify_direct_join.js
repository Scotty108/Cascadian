require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'polymarket'
});

async function verifyJoin() {
  console.log('=== VERIFYING DIRECT JOIN SUCCESS ===\n');

  // Verify the direct string join works
  console.log('📋 Testing direct string join (asset_id = token_id)');
  console.log('─'.repeat(60));

  try {
    const joinResult = await client.query({
      query: `
        SELECT
          f.asset_id,
          f.condition_id,
          f.side,
          f.price,
          f.size,
          t.token_id,
          t.outcome_index,
          t.condition_id_norm,
          t.source
        FROM clob_fills f
        INNER JOIN ctf_token_map t ON f.asset_id = t.token_id
        WHERE f.asset_id != ''
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });
    const results = await joinResult.json();

    console.log(`Found ${results.length} sample matches!\n`);

    results.forEach((row, idx) => {
      console.log(`${idx + 1}. Fill Details:`);
      console.log(`   Asset ID: ${row.asset_id}`);
      console.log(`   Token ID: ${row.token_id}`);
      console.log(`   Match: ${row.asset_id === row.token_id ? '✅' : '❌'}`);
      console.log(`   Condition ID (fill): ${row.condition_id}`);
      console.log(`   Condition ID (map):  ${row.condition_id_norm}`);
      console.log(`   Side: ${row.side}, Outcome Index: ${row.outcome_index}`);
      console.log(`   Price: ${row.price}, Size: ${row.size}`);
      console.log('');
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Verify outcome index distribution in successful joins
  console.log('\n📋 Outcome index distribution in mapped fills');
  console.log('─'.repeat(60));

  try {
    const distResult = await client.query({
      query: `
        SELECT
          t.outcome_index,
          f.side,
          count() as count,
          sum(f.size) as total_size
        FROM clob_fills f
        INNER JOIN ctf_token_map t ON f.asset_id = t.token_id
        WHERE f.asset_id != ''
        GROUP BY t.outcome_index, f.side
        ORDER BY t.outcome_index, f.side
      `,
      format: 'JSONEachRow'
    });
    const dist = await distResult.json();

    console.log('Distribution:');
    dist.forEach(row => {
      console.log(`  Outcome ${row.outcome_index}, Side ${row.side}: ${row.count} fills, ${row.total_size} total size`);
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check a specific condition_id for consistency
  console.log('\n📋 Sample condition consistency check');
  console.log('─'.repeat(60));

  try {
    const conditionResult = await client.query({
      query: `
        SELECT
          f.condition_id,
          f.asset_id,
          f.side,
          t.outcome_index,
          count() as fill_count
        FROM clob_fills f
        INNER JOIN ctf_token_map t ON f.asset_id = t.token_id
        WHERE f.condition_id = '0xc1d04fa81a90a79add0a6df1677cf58f044107abb198011878c15ec2c1b44019'
        GROUP BY f.condition_id, f.asset_id, f.side, t.outcome_index
        ORDER BY t.outcome_index, f.side
      `,
      format: 'JSONEachRow'
    });
    const conditionData = await conditionResult.json();

    console.log('Condition: 0xc1d04fa81a90a79add0a6df1677cf58f044107abb198011878c15ec2c1b44019');
    conditionData.forEach(row => {
      console.log(`  Asset ${row.asset_id.substring(0, 20)}...`);
      console.log(`    Outcome: ${row.outcome_index}, Side: ${row.side}, Fills: ${row.fill_count}`);
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Final verification: Can we calculate P&L?
  console.log('\n📋 P&L calculation test');
  console.log('─'.repeat(60));

  try {
    const pnlResult = await client.query({
      query: `
        WITH enriched_fills AS (
          SELECT
            f.proxy_wallet,
            f.condition_id,
            f.side,
            f.price,
            f.size,
            t.outcome_index
          FROM clob_fills f
          INNER JOIN ctf_token_map t ON f.asset_id = t.token_id
          WHERE f.asset_id != ''
            AND f.proxy_wallet != ''
          LIMIT 100000
        )
        SELECT
          proxy_wallet,
          condition_id,
          outcome_index,
          side,
          count() as fill_count,
          sum(size) as total_size,
          avg(price) as avg_price,
          sum(CASE WHEN side = 'BUY' THEN size * price ELSE -size * (1 - price) END) as cost_basis
        FROM enriched_fills
        GROUP BY proxy_wallet, condition_id, outcome_index, side
        ORDER BY total_size DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const pnlData = await pnlResult.json();

    console.log('Sample P&L-ready positions:');
    pnlData.forEach((row, idx) => {
      console.log(`\n${idx + 1}. Wallet: ${row.proxy_wallet.substring(0, 10)}...`);
      console.log(`   Condition: ${row.condition_id.substring(0, 20)}...`);
      console.log(`   Outcome: ${row.outcome_index}, Side: ${row.side}`);
      console.log(`   Fills: ${row.fill_count}, Size: ${row.total_size}`);
      console.log(`   Avg Price: ${row.avg_price}, Cost Basis: ${row.cost_basis}`);
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Verification complete!');
  console.log('='.repeat(60));

  await client.close();
}

verifyJoin().catch(console.error);
