/**
 * CRITICAL DIAGNOSTIC: Empty Condition IDs Investigation
 *
 * Finding: Wallets 2-4 have 1,612 trades with EMPTY condition_id ('')
 * This is why no P&L is calculated - can't join to resolution data!
 */

import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

const WALLETS = {
  wallet2: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  wallet3: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  wallet4: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
};

async function main() {
  try {
    console.log('\n=== CRITICAL FINDING: EMPTY CONDITION IDs ===\n');

    // 1. Count empty condition_ids per wallet
    console.log('1. Empty condition_id counts by wallet:\n');
    const countQuery = `
      SELECT
        wallet_address,
        countIf(condition_id = '') as empty_condition_ids,
        countIf(condition_id != '') as valid_condition_ids,
        count(*) as total_trades
      FROM trades_raw
      WHERE wallet_address IN (
        '${WALLETS.wallet2}',
        '${WALLETS.wallet3}',
        '${WALLETS.wallet4}'
      )
      GROUP BY wallet_address
      ORDER BY empty_condition_ids DESC
    `;

    const countResult = await client.query({ query: countQuery, format: 'JSONEachRow' });
    const counts = await countResult.json();
    console.table(counts);

    // 2. Sample empty condition_id trades
    console.log('\n2. Sample trades with empty condition_id:\n');
    const sampleQuery = `
      SELECT
        wallet_address,
        market_id,
        condition_id,
        side,
        outcome,
        shares,
        entry_price,
        timestamp,
        transaction_hash
      FROM trades_raw
      WHERE wallet_address IN (
        '${WALLETS.wallet2}',
        '${WALLETS.wallet3}',
        '${WALLETS.wallet4}'
      )
      AND condition_id = ''
      LIMIT 10
    `;

    const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json();
    console.table(samples);

    // 3. Check if market_id exists for empty condition_ids
    console.log('\n3. Market IDs for empty condition_id trades:\n');
    const marketQuery = `
      SELECT
        market_id,
        count(*) as trade_count,
        countDistinct(wallet_address) as wallet_count,
        min(timestamp) as first_trade,
        max(timestamp) as last_trade
      FROM trades_raw
      WHERE wallet_address IN (
        '${WALLETS.wallet2}',
        '${WALLETS.wallet3}',
        '${WALLETS.wallet4}'
      )
      AND condition_id = ''
      GROUP BY market_id
      ORDER BY trade_count DESC
      LIMIT 10
    `;

    const marketResult = await client.query({ query: marketQuery, format: 'JSONEachRow' });
    const markets = await marketResult.json();
    console.table(markets);

    // 4. Can we find condition_id from market_id?
    if (markets.length > 0) {
      const sampleMarketId = markets[0].market_id;
      console.log(`\n4. Looking up condition_id for market_id: ${sampleMarketId}\n`);

      const lookupQuery = `
        SELECT
          market_id,
          condition_id
        FROM condition_market_map
        WHERE market_id = '${sampleMarketId}'
        LIMIT 5
      `;

      const lookupResult = await client.query({ query: lookupQuery, format: 'JSONEachRow' });
      const lookups = await lookupResult.json();
      console.table(lookups);

      if (lookups.length > 0) {
        console.log('\n✅ FOUND: condition_id CAN be derived from market_id!\n');
        console.log('ROOT CAUSE: trades_raw has empty condition_id but market_id is present.');
        console.log('FIX: Join trades_raw to condition_market_map on market_id to get condition_id.');
      } else {
        console.log('\n❌ NOT FOUND: No mapping exists for this market_id\n');
      }
    }

    // 5. Check if we have alternate ways to identify these trades
    console.log('\n5. Check alternate identification methods:\n');
    const altQuery = `
      SELECT
        countIf(market_id != '') as has_market_id,
        countIf(transaction_hash != '') as has_tx_hash,
        count(*) as total_empty_condition
      FROM trades_raw
      WHERE wallet_address IN (
        '${WALLETS.wallet2}',
        '${WALLETS.wallet3}',
        '${WALLETS.wallet4}'
      )
      AND condition_id = ''
    `;

    const altResult = await client.query({ query: altQuery, format: 'JSONEachRow' });
    const altCounts = await altResult.json();
    console.table(altCounts);

    // 7. Summary
    console.log('\n=== DIAGNOSIS SUMMARY ===\n');
    console.log('PROBLEM: 1,612 trades for wallets 2-4 have empty condition_id (\'\')');
    console.log('IMPACT: Cannot join to market_resolutions_final → No P&L calculated');
    console.log('\nPOTENTIAL FIXES:');
    console.log('  1. Use market_id to lookup condition_id via condition_market_map');
    console.log('  2. Use token_id to lookup condition_id via ctf_token_map');
    console.log('  3. Backfill condition_id in trades_raw from available mappings');
    console.log('\nNEXT STEP: Update trades_raw to populate empty condition_ids');

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
