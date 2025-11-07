import { createClient } from '@clickhouse/client';

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DB || 'polymarket',
});

const TEST_WALLETS = [
  '0x7f3c8979d0afa00007bae4747d5347122af05613',
  '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
];

async function runTest1() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('PHASE 2 TEST 1: WALLET EXISTENCE CHECK');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`Testing ${TEST_WALLETS.length} wallets...\n`);

  try {
    // Test 1a: Check trades_enriched_with_condition
    console.log('📊 Checking trades_enriched_with_condition...');
    const query1a = `
      SELECT
        'trades_enriched_with_condition' as source,
        wallet_address,
        count() as trade_count,
        min(created_at) as first_trade,
        max(created_at) as last_trade
      FROM trades_enriched_with_condition
      WHERE lower(wallet_address) IN (
        ${TEST_WALLETS.map(w => `lower('${w}')`).join(', ')}
      )
      GROUP BY wallet_address
      ORDER BY trade_count DESC
    `;

    const result1a = await client.query({
      query: query1a,
      format: 'JSONEachRow',
    });

    const rows1a = await result1a.json();

    if (rows1a.length === 0) {
      console.log('❌ NO WALLETS FOUND in trades_enriched_with_condition\n');
    } else {
      console.log(`✅ Found ${rows1a.length} wallets with trades:`);
      rows1a.forEach(row => {
        console.log(`   ${row.wallet_address.substring(0, 10)}... : ${row.trade_count} trades (${row.first_trade} to ${row.last_trade})`);
      });
      console.log();
    }

    // Test 1b: Check trades_raw as fallback
    console.log('📊 Checking trades_raw (fallback)...');
    const query1b = `
      SELECT
        'trades_raw' as source,
        wallet_address,
        count() as trade_count,
        min(block_time) as first_trade,
        max(block_time) as last_trade
      FROM trades_raw
      WHERE lower(wallet_address) IN (
        ${TEST_WALLETS.map(w => `lower('${w}')`).join(', ')}
      )
      GROUP BY wallet_address
      ORDER BY trade_count DESC
    `;

    const result1b = await client.query({
      query: query1b,
      format: 'JSONEachRow',
    });

    const rows1b = await result1b.json();

    if (rows1b.length === 0) {
      console.log('❌ NO WALLETS FOUND in trades_raw\n');
    } else {
      console.log(`✅ Found ${rows1b.length} wallets with trades:`);
      rows1b.forEach(row => {
        console.log(`   ${row.wallet_address.substring(0, 10)}... : ${row.trade_count} trades`);
      });
      console.log();
    }

    // Summary and decision
    console.log('════════════════════════════════════════════════════════════════');
    console.log('TEST 1 RESULTS AND NEXT STEPS');
    console.log('════════════════════════════════════════════════════════════════\n');

    if (rows1a.length > 0) {
      console.log('✅ RESULT: Wallets EXIST in trades_enriched_with_condition');
      console.log('   → Proceed to Test 2 (Resolution Coverage Check)');
      console.log('   → The query logic might be broken, not the data\n');
    } else if (rows1b.length > 0) {
      console.log('⚠️  RESULT: Wallets exist in trades_raw but NOT in trades_enriched_with_condition');
      console.log('   → Data exists in raw form but enrichment failed');
      console.log('   → Need to rebuild enriched tables\n');
    } else {
      console.log('❌ RESULT: Wallets NOT FOUND in any table');
      console.log('   → Wallets may not be ingested yet');
      console.log('   → OR wallet addresses are incorrect');
      console.log('   → Need to verify with user\n');
    }

  } catch (error) {
    console.error('❌ Error running Test 1:');
    console.error(error);
    process.exit(1);
  }
}

runTest1().catch(console.error);
