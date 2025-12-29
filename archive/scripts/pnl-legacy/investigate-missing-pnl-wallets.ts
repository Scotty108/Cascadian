#!/usr/bin/env npx tsx
/**
 * INVESTIGATION: Missing P&L for wallets 2-4
 *
 * Known UI P&L values:
 * - 0x1489046ca0f9980fc2d9a950d103d3bec02c1307 → $137,663 ✅ (2,015 resolved trades)
 * - 0x8e9eedf20dfa70956d49f608a205e402d9df38e4 → $360,492 ❌ (0 resolved trades)
 * - 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b → $94,730 ❌ (0 resolved trades)
 * - 0x6770bf688b8121331b1c5cfd7723ebd4152545fb → $12,171 ❌ (0 resolved trades)
 *
 * Diagnostic steps:
 * 1. Check raw trade counts per wallet
 * 2. Verify condition_id coverage in market_resolutions_final
 * 3. Check is_resolved field accuracy
 * 4. Explore alternative tables
 * 5. Analyze date ranges
 * 6. Check data quality (nulls, flags)
 */

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000
});

const testWallets = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, status: '✅' },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, status: '❌' },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, status: '❌' },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, status: '❌' }
];

async function investigateWallets() {
  console.log('='.repeat(80));
  console.log('WALLET P&L INVESTIGATION - Finding Missing Data');
  console.log('='.repeat(80));
  console.log();

  // STEP 1: Check raw trade counts per wallet
  console.log('STEP 1: Raw Trade Counts in trades_raw');
  console.log('-'.repeat(80));

  for (const wallet of testWallets) {
    const query = `
      SELECT
        wallet_address,
        count() as total_trades,
        countIf(is_resolved = 1) as resolved_trades,
        countIf(is_resolved = 0) as unresolved_trades,
        countIf(is_resolved IS NULL) as null_resolved,
        min(timestamp) as earliest_trade,
        max(timestamp) as latest_trade,
        uniq(condition_id) as unique_conditions
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${wallet.address}')
      GROUP BY wallet_address
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    console.log(`\nWallet: ${wallet.address}`);
    console.log(`UI P&L: $${wallet.ui_pnl.toLocaleString()} ${wallet.status}`);
    if (data.length > 0) {
      console.log(`Total Trades: ${data[0].total_trades}`);
      console.log(`Resolved: ${data[0].resolved_trades} | Unresolved: ${data[0].unresolved_trades} | NULL: ${data[0].null_resolved}`);
      console.log(`Date Range: ${data[0].earliest_trade} → ${data[0].latest_trade}`);
      console.log(`Unique Conditions: ${data[0].unique_conditions}`);
    } else {
      console.log('❌ NO TRADES FOUND IN trades_raw');
    }
  }

  // STEP 2: Check condition_id normalization and coverage
  console.log('\n' + '='.repeat(80));
  console.log('STEP 2: Condition ID Coverage Analysis');
  console.log('-'.repeat(80));

  for (const wallet of testWallets) {
    const query = `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet.address}')
      ),
      resolved_conditions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
        FROM market_resolutions_final
      )
      SELECT
        (SELECT count() FROM wallet_conditions) as wallet_total_conditions,
        (SELECT count() FROM resolved_conditions) as total_resolved_conditions,
        (SELECT count()
         FROM wallet_conditions wc
         INNER JOIN resolved_conditions rc ON wc.condition_id_norm = rc.condition_id_norm
        ) as matched_conditions,
        (SELECT count()
         FROM wallet_conditions wc
         LEFT JOIN resolved_conditions rc ON wc.condition_id_norm = rc.condition_id_norm
         WHERE rc.condition_id_norm IS NULL
        ) as unmatched_conditions
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    console.log(`\nWallet: ${wallet.address.slice(0, 10)}...`);
    if (data.length > 0 && data[0].wallet_total_conditions > 0) {
      const match_rate = (data[0].matched_conditions / data[0].wallet_total_conditions * 100).toFixed(1);
      console.log(`Wallet Conditions: ${data[0].wallet_total_conditions}`);
      console.log(`Matched in Resolutions: ${data[0].matched_conditions} (${match_rate}%)`);
      console.log(`Unmatched: ${data[0].unmatched_conditions}`);

      if (data[0].unmatched_conditions > 0) {
        console.log('⚠️  POTENTIAL ISSUE: Unmatched conditions found');
      }
    } else {
      console.log('❌ No conditions found for this wallet');
    }
  }

  // STEP 3: Sample unmatched conditions for one failing wallet
  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: Sample Unmatched Conditions (Wallet 2)');
  console.log('-'.repeat(80));

  const sampleQuery = `
    WITH wallet_conditions AS (
      SELECT DISTINCT
        condition_id,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        any(market_slug) as sample_market_slug,
        count() as trade_count
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${testWallets[1].address}')
      GROUP BY condition_id, condition_id_norm
    ),
    resolved_conditions AS (
      SELECT DISTINCT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
      FROM market_resolutions_final
    )
    SELECT
      wc.condition_id,
      wc.condition_id_norm,
      wc.sample_market_slug,
      wc.trade_count,
      CASE WHEN rc.condition_id_norm IS NOT NULL THEN 'MATCHED' ELSE 'UNMATCHED' END as status
    FROM wallet_conditions wc
    LEFT JOIN resolved_conditions rc ON wc.condition_id_norm = rc.condition_id_norm
    ORDER BY wc.trade_count DESC
    LIMIT 20
  `;

  const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json();

  console.log('\nTop 20 Conditions by Trade Count:');
  console.table(sampleData);

  // STEP 4: Check alternative tables
  console.log('\n' + '='.repeat(80));
  console.log('STEP 4: Alternative Table Exploration');
  console.log('-'.repeat(80));

  // Check for trade_flows_v2
  try {
    const tfQuery = `
      SELECT
        wallet,
        count() as total_entries,
        uniq(condition_id) as unique_conditions
      FROM trade_flows_v2
      WHERE lower(wallet_address) = lower('${testWallets[1].address}')
      GROUP BY wallet
      LIMIT 1
    `;
    const tfResult = await client.query({ query: tfQuery, format: 'JSONEachRow' });
    const tfData = await tfResult.json();
    console.log('\ntrade_flows_v2 exists!');
    console.log(tfData.length > 0 ? tfData[0] : 'No data for wallet 2');
  } catch (e) {
    console.log('\ntrade_flows_v2: Does not exist or error accessing');
  }

  // Check for pm_trades
  try {
    const pmQuery = `
      SELECT
        wallet,
        count() as total_entries,
        uniq(condition_id) as unique_conditions
      FROM pm_trades
      WHERE lower(wallet_address) = lower('${testWallets[1].address}')
      GROUP BY wallet
      LIMIT 1
    `;
    const pmResult = await client.query({ query: pmQuery, format: 'JSONEachRow' });
    const pmData = await pmResult.json();
    console.log('\npm_trades exists!');
    console.log(pmData.length > 0 ? pmData[0] : 'No data for wallet 2');
  } catch (e) {
    console.log('\npm_trades: Does not exist or error accessing');
  }

  // STEP 5: Check is_resolved field reliability
  console.log('\n' + '='.repeat(80));
  console.log('STEP 5: is_resolved Field Accuracy Check');
  console.log('-'.repeat(80));

  for (const wallet of testWallets) {
    const query = `
      SELECT
        is_resolved,
        count() as trade_count,
        uniq(condition_id) as unique_conditions,
        sum(shares) as total_shares
      FROM trades_raw
      WHERE lower(wallet) = lower('${wallet.address}')
      GROUP BY is_resolved
      ORDER BY is_resolved
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json();

    console.log(`\nWallet: ${wallet.address.slice(0, 10)}... (UI P&L: $${wallet.ui_pnl.toLocaleString()})`);
    if (data.length > 0) {
      console.table(data);
    } else {
      console.log('No data');
    }
  }

  // STEP 6: List all tables with potential trade data
  console.log('\n' + '='.repeat(80));
  console.log('STEP 6: All Available Tables in Database');
  console.log('-'.repeat(80));

  const tablesQuery = `
    SELECT
      name,
      engine,
      total_rows,
      total_bytes
    FROM system.tables
    WHERE database = 'polymarket'
      AND name LIKE '%trade%' OR name LIKE '%pnl%' OR name LIKE '%position%'
    ORDER BY total_rows DESC
  `;

  const tablesResult = await client.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tablesData = await tablesResult.json();

  console.log('\nTables matching trade/pnl/position patterns:');
  console.table(tablesData);

  // STEP 7: Check market_resolutions_final structure
  console.log('\n' + '='.repeat(80));
  console.log('STEP 7: market_resolutions_final Coverage');
  console.log('-'.repeat(80));

  const resQuery = `
    SELECT
      count() as total_resolutions,
      uniq(condition_id) as unique_conditions,
      min(resolution_date) as earliest_resolution,
      max(resolution_date) as latest_resolution
    FROM market_resolutions_final
  `;

  const resResult = await client.query({ query: resQuery, format: 'JSONEachRow' });
  const resData = await resResult.json();

  console.log('\nmarket_resolutions_final summary:');
  console.table(resData);

  console.log('\n' + '='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
}

investigateWallets()
  .then(() => {
    console.log('\n✅ Investigation finished successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Investigation failed:', err);
    process.exit(1);
  });
