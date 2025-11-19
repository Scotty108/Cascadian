import { clickhouse } from './lib/clickhouse/client';

async function verifyXiData() {
  console.log('=== VERIFYING XI JINPING MARKET DATA ===\n');

  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const conditionId = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

  // Check 1: Verify table exists and has data
  console.log('1. Checking pm_trades_canonical_v3 table...');
  const tableCheck = await clickhouse.query({
    query: `
      SELECT count() AS total_count
      FROM pm_trades_canonical_v3
    `,
    format: 'JSONEachRow'
  });
  const tableData = await tableCheck.json<{ total_count: number }>();
  console.log(`   Total rows in table: ${tableData[0].total_count}`);

  // Check 2: Find wallet with variations
  console.log('\n2. Checking wallet variations...');
  const walletCheck = await clickhouse.query({
    query: `
      SELECT
        count() AS trade_count,
        groupUniqArray(wallet_address) AS wallet_variations
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = {wallet:String}
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow'
  });
  const walletData = await walletCheck.json();
  console.log(`   Trades for wallet: ${walletData[0].trade_count}`);
  console.log(`   Wallet variations:`, walletData[0].wallet_variations);

  // Check 3: Find condition ID with variations
  console.log('\n3. Checking condition ID variations...');
  const conditionCheck = await clickhouse.query({
    query: `
      SELECT
        count() AS trade_count,
        groupUniqArray(condition_id_norm_v3) AS condition_variations
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = {condition:String}
         OR condition_id_norm_v3 = {condition_with_0x:String}
    `,
    query_params: {
      condition: conditionId,
      condition_with_0x: '0x' + conditionId
    },
    format: 'JSONEachRow'
  });
  const conditionData = await conditionCheck.json();
  console.log(`   Trades for condition: ${conditionData[0].trade_count}`);
  console.log(`   Condition variations:`, conditionData[0].condition_variations);

  // Check 4: Try finding the market by searching clob_fills
  console.log('\n4. Checking clob_fills for Xi Jinping market...');
  const clobCheck = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        count() AS fill_count,
        any(market_id) AS market_id
      FROM clob_fills
      WHERE lower(market_id) LIKE '%xi%jinping%'
         OR lower(market_id) LIKE '%china%president%'
      GROUP BY condition_id
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const clobData = await clobCheck.json();
  console.log(`   Markets found: ${clobData.length}`);
  if (clobData.length > 0) {
    console.log('   Xi market candidates:');
    clobData.forEach((m: any) => {
      console.log(`   - ${m.market_id}: ${m.condition_id} (${m.fill_count} fills)`);
    });
  }

  // Check 5: Look for the wallet's largest markets
  console.log('\n5. Finding largest markets for wallet...');
  const topMarkets = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm_v3,
        count() AS trade_count,
        sum(usd_value) AS total_value
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = {wallet:String}
      GROUP BY condition_id_norm_v3
      ORDER BY total_value DESC
      LIMIT 10
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow'
  });
  const topData = await topMarkets.json();
  console.log('   Top markets by value:');
  topData.forEach((m: any, idx: number) => {
    console.log(`   ${idx + 1}. ${m.condition_id_norm_v3}: ${m.trade_count} trades, $${parseFloat(m.total_value).toFixed(2)}`);
  });
}

verifyXiData()
  .then(() => {
    console.log('\n✅ Verification complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });
