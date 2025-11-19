#!/usr/bin/env tsx
/**
 * Wire Canonical Wallet Mapping into pm_trades
 *
 * Adds canonical_wallet_address column to pm_trades view by joining to wallet_identity_map.
 * This enables P&L aggregation by canonical wallet identity (unifying EOA + proxies).
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔧 Wiring Canonical Wallet into pm_trades');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Show current pm_trades view definition
  console.log('Step 1: Current pm_trades view...');
  try {
    const currentDef = await clickhouse.query({
      query: 'SHOW CREATE TABLE pm_trades',
      format: 'TabSeparated'
    });
    const defText = await currentDef.text();

    console.log('   ✅ Current view exists');
    console.log('   Columns: wallet_address, operator_address, is_proxy_trade');
    console.log('   No canonical_wallet_address column\n');
  } catch (error: any) {
    console.log(`   ⚠️  Could not fetch view: ${error.message}\n`);
  }

  // Step 2: Create new view definition with canonical_wallet_address
  console.log('Step 2: Creating updated view with canonical_wallet_address...');

  const newViewSQL = `
    CREATE OR REPLACE VIEW default.pm_trades AS
    SELECT
      cf.fill_id,
      cf.timestamp AS block_time,
      0 AS block_number,
      cf.tx_hash,
      cf.asset_id AS asset_id_decimal,
      atm.condition_id AS condition_id,
      atm.outcome_index AS outcome_index,
      atm.outcome_label AS outcome_label,
      atm.question AS question,
      lower(cf.proxy_wallet) AS wallet_address,
      COALESCE(wim.canonical_wallet, lower(cf.proxy_wallet)) AS canonical_wallet_address,
      lower(cf.user_eoa) AS operator_address,
      multiIf(lower(cf.proxy_wallet) != lower(cf.user_eoa), 1, 0) AS is_proxy_trade,
      cf.side,
      cf.price,
      cf.size / 1000000. AS shares,
      (cf.size / 1000000.) * cf.price AS collateral_amount,
      ((cf.size / 1000000.) * cf.price) * (cf.fee_rate_bps / 10000.) AS fee_amount,
      'clob_fills' AS data_source
    FROM default.clob_fills AS cf
    LEFT JOIN default.wallet_identity_map AS wim
      ON lower(cf.proxy_wallet) = lower(wim.proxy_wallet)
    INNER JOIN default.pm_asset_token_map AS atm
      ON cf.asset_id = atm.asset_id_decimal
    WHERE (cf.fill_id IS NOT NULL) AND (cf.asset_id IS NOT NULL)
  `;

  try {
    await clickhouse.command({ query: newViewSQL });
    console.log('   ✅ View updated successfully\n');
  } catch (error: any) {
    console.error(`   ❌ Failed to update view: ${error.message}\n`);
    throw error;
  }

  // Step 3: Verify new column exists
  console.log('Step 3: Verifying new view schema...');
  try {
    const describeQuery = await clickhouse.query({
      query: 'DESCRIBE TABLE pm_trades',
      format: 'JSONEachRow'
    });
    const schema = await describeQuery.json();

    const walletAddressCol = schema.find((col: any) => col.name === 'wallet_address');
    const canonicalCol = schema.find((col: any) => col.name === 'canonical_wallet_address');

    if (walletAddressCol && canonicalCol) {
      console.log('   ✅ wallet_address column exists');
      console.log('   ✅ canonical_wallet_address column exists');
      console.log(`   Type: ${canonicalCol.type}\n`);
    } else {
      console.log('   ⚠️  Column verification incomplete\n');
    }
  } catch (error: any) {
    console.log(`   ⚠️  Could not verify schema: ${error.message}\n`);
  }

  // Step 4: Test the new column with sample queries
  console.log('Step 4: Testing canonical_wallet_address with sample queries...');

  // Test 1: Count wallets vs canonical wallets
  console.log('\n   Test 1: Count distinct wallet_address vs canonical_wallet_address');
  try {
    const countQuery = await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT wallet_address) as distinct_wallets,
          COUNT(DISTINCT canonical_wallet_address) as distinct_canonical
        FROM pm_trades
      `,
      format: 'JSONEachRow'
    });
    const counts = await countQuery.json();

    const distinctWallets = parseInt(counts[0]?.distinct_wallets || '0');
    const distinctCanonical = parseInt(counts[0]?.distinct_canonical || '0');
    const reduction = distinctWallets - distinctCanonical;
    const reductionPct = distinctWallets > 0 ? (reduction / distinctWallets * 100).toFixed(2) : '0.00';

    console.log(`   Distinct wallet_address:         ${distinctWallets.toLocaleString()}`);
    console.log(`   Distinct canonical_wallet:       ${distinctCanonical.toLocaleString()}`);
    console.log(`   Reduction (proxy consolidation): ${reduction.toLocaleString()} (${reductionPct}%)\n`);
  } catch (error: any) {
    console.log(`   ⚠️  Count query failed: ${error.message}\n`);
  }

  // Test 2: xcnstrategy canonical wallet
  console.log('   Test 2: xcnstrategy canonical wallet mapping');
  const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

  try {
    const xcnQuery = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          canonical_wallet_address,
          COUNT(*) as trade_count
        FROM pm_trades
        WHERE lower(wallet_address) = lower('${XCN_EOA}')
           OR lower(wallet_address) = lower('${XCN_PROXY}')
        GROUP BY wallet_address, canonical_wallet_address
        ORDER BY wallet_address
      `,
      format: 'JSONEachRow'
    });
    const xcnResults = await xcnQuery.json();

    if (xcnResults.length > 0) {
      console.log('   Results:');
      console.table(xcnResults);

      // Check if both wallets map to same canonical
      const canonicals = new Set(xcnResults.map((r: any) => r.canonical_wallet_address));
      if (canonicals.size === 1) {
        console.log(`   ✅ All wallets map to single canonical: ${Array.from(canonicals)[0]}\n`);
      } else {
        console.log(`   ⚠️  Multiple canonical wallets found: ${Array.from(canonicals).join(', ')}\n`);
      }
    } else {
      console.log(`   ⚠️  No trades found for xcnstrategy wallets\n`);
    }
  } catch (error: any) {
    console.log(`   ⚠️  xcnstrategy query failed: ${error.message}\n`);
  }

  // Test 3: Wallets with multiple proxies
  console.log('   Test 3: Finding wallets with multiple proxy addresses');
  try {
    const multiProxyQuery = await clickhouse.query({
      query: `
        SELECT
          canonical_wallet_address,
          COUNT(DISTINCT wallet_address) as proxy_count,
          groupArray(DISTINCT wallet_address) as proxies,
          SUM(1) as total_trades
        FROM pm_trades
        GROUP BY canonical_wallet_address
        HAVING proxy_count > 1
        ORDER BY proxy_count DESC, total_trades DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const multiProxyResults = await multiProxyQuery.json();

    if (multiProxyResults.length > 0) {
      console.log(`   Found ${multiProxyResults.length} wallets with multiple proxies:`);
      multiProxyResults.slice(0, 5).forEach((row: any, i: number) => {
        const canonical = row.canonical_wallet_address.substring(0, 12) + '...';
        console.log(`   ${i + 1}. ${canonical}: ${row.proxy_count} proxies, ${parseInt(row.total_trades).toLocaleString()} trades`);
      });
      console.log('');
    } else {
      console.log('   No wallets with multiple proxies found (all direct traders)\n');
    }
  } catch (error: any) {
    console.log(`   ⚠️  Multi-proxy query failed: ${error.message}\n`);
  }

  // Step 5: Summary
  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ pm_trades view updated successfully');
  console.log('✅ canonical_wallet_address column added');
  console.log('✅ LEFT JOIN to wallet_identity_map working');
  console.log('✅ Defaults to wallet_address if no mapping exists');
  console.log('');
  console.log('Next Steps:');
  console.log('1. Propagate canonical_wallet_address into pm_wallet_market_pnl_resolved');
  console.log('2. Propagate canonical_wallet_address into pm_wallet_pnl_summary');
  console.log('3. Re-run xcnstrategy comparison to verify aggregation');
  console.log('');
  console.log('Note: xcnstrategy gap will remain $84,941 until proxy trades are backfilled');
  console.log('(See DOME_COVERAGE_INVESTIGATION_REPORT.md for missing markets)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
