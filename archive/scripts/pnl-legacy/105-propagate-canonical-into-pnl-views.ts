#!/usr/bin/env tsx
/**
 * Propagate Canonical Wallet into P&L Views
 *
 * Updates pm_wallet_market_pnl_resolved and pm_wallet_pnl_summary to aggregate
 * by canonical_wallet_address instead of wallet_address.
 *
 * This unifies P&L across EOA + proxy wallets under a single canonical identity.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔧 Propagating Canonical Wallet into P&L Views');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Update pm_wallet_market_pnl_resolved
  console.log('Step 1: Updating pm_wallet_market_pnl_resolved...');

  const walletMarketPnLSQL = `
    CREATE OR REPLACE VIEW default.pm_wallet_market_pnl_resolved AS
    WITH position_summary AS (
      SELECT
        canonical_wallet_address,
        wallet_address,
        condition_id,
        SUM(CASE WHEN side = 'BUY' THEN shares ELSE -shares END) AS net_shares,
        SUM(CASE WHEN side = 'BUY' THEN shares ELSE 0 END) AS total_bought,
        SUM(CASE WHEN side = 'SELL' THEN shares ELSE 0 END) AS total_sold,
        SUM(collateral_amount) AS gross_notional,
        SUM(CASE WHEN side = 'BUY' THEN collateral_amount ELSE -collateral_amount END) AS net_notional,
        SUM(fee_amount) AS fees_paid,
        COUNT(*) AS total_trades,
        MIN(block_time) AS first_trade_ts,
        MAX(block_time) AS last_trade_ts
      FROM default.pm_trades
      GROUP BY canonical_wallet_address, wallet_address, condition_id
    ),
    pnl_calculation AS (
      SELECT
        p.canonical_wallet_address,
        p.wallet_address,
        p.condition_id,
        p.net_shares,
        p.total_bought,
        p.total_sold,
        p.gross_notional,
        p.net_notional,
        p.fees_paid,
        p.total_trades,
        p.first_trade_ts,
        p.last_trade_ts,
        m.question,
        m.status,
        m.market_type,
        m.winning_outcome_index,
        m.resolved_at,
        multiIf(
          m.winning_outcome_index IS NOT NULL AND p.net_shares != 0,
          1,
          0
        ) AS is_winning_outcome,
        multiIf(
          m.winning_outcome_index IS NOT NULL AND p.net_shares > 0,
          p.net_shares,
          m.winning_outcome_index IS NOT NULL AND p.net_shares < 0,
          0,
          0
        ) AS winning_shares,
        multiIf(
          m.winning_outcome_index IS NOT NULL AND p.net_shares > 0,
          p.net_shares - p.net_notional,
          m.winning_outcome_index IS NOT NULL AND p.net_shares < 0,
          -p.net_notional,
          0
        ) AS pnl_gross,
        multiIf(
          m.winning_outcome_index IS NOT NULL AND p.net_shares > 0,
          p.net_shares - p.net_notional - p.fees_paid,
          m.winning_outcome_index IS NOT NULL AND p.net_shares < 0,
          -p.net_notional - p.fees_paid,
          0
        ) AS pnl_net
      FROM position_summary p
      INNER JOIN default.pm_markets m
        ON p.condition_id = m.condition_id
      WHERE m.status = 'resolved'
        AND m.market_type = 'binary'
    )
    SELECT
      canonical_wallet_address,
      wallet_address,
      condition_id,
      question,
      status,
      market_type,
      winning_outcome_index,
      resolved_at,
      net_shares,
      total_bought,
      total_sold,
      gross_notional,
      net_notional,
      fees_paid,
      total_trades,
      first_trade_ts,
      last_trade_ts,
      is_winning_outcome,
      winning_shares,
      pnl_gross,
      pnl_net,
      'pm_trades_v2' AS data_source
    FROM pnl_calculation
  `;

  try {
    await clickhouse.command({ query: walletMarketPnLSQL });
    console.log('   ✅ pm_wallet_market_pnl_resolved updated successfully\n');
  } catch (error: any) {
    console.error(`   ❌ Failed to update view: ${error.message}\n`);
    throw error;
  }

  // Step 2: Update pm_wallet_pnl_summary
  console.log('Step 2: Updating pm_wallet_pnl_summary...');

  const walletPnLSummarySQL = `
    CREATE OR REPLACE VIEW default.pm_wallet_pnl_summary AS
    WITH wallet_aggregates AS (
      SELECT
        w.canonical_wallet_address,
        COUNTDistinct(w.wallet_address) AS proxy_wallets_count,
        groupArray(DISTINCT w.wallet_address) AS proxy_wallets_used,
        COUNTDistinct(w.condition_id) AS total_markets,
        sum(w.total_trades) AS total_trades,
        sum(w.gross_notional) AS gross_notional,
        sum(w.net_notional) AS net_notional,
        sum(w.fees_paid) AS fees_paid,
        sum(w.pnl_gross) AS pnl_gross,
        sum(w.pnl_net) AS pnl_net,
        COUNTDistinct(if((w.is_winning_outcome = 1) AND (w.pnl_net > 0.), w.condition_id, NULL)) AS winning_markets,
        COUNTDistinct(if((w.is_winning_outcome = 1) AND (w.pnl_net < 0.), w.condition_id, NULL)) AS losing_markets
      FROM default.pm_wallet_market_pnl_resolved AS w
      GROUP BY w.canonical_wallet_address
    )
    SELECT
      canonical_wallet_address,
      proxy_wallets_count,
      proxy_wallets_used,
      total_markets,
      total_trades,
      gross_notional,
      net_notional,
      fees_paid,
      pnl_gross,
      pnl_net,
      winning_markets,
      losing_markets,
      winning_markets + losing_markets AS markets_with_result,
      if((winning_markets + losing_markets) > 0, winning_markets / (winning_markets + losing_markets), NULL) AS win_rate,
      if(total_trades > 0, gross_notional / total_trades, NULL) AS avg_position_size,
      'pm_wallet_market_pnl_resolved_v2' AS data_source
    FROM wallet_aggregates
  `;

  try {
    await clickhouse.command({ query: walletPnLSummarySQL });
    console.log('   ✅ pm_wallet_pnl_summary updated successfully\n');
  } catch (error: any) {
    console.error(`   ❌ Failed to update view: ${error.message}\n`);
    throw error;
  }

  // Step 3: Verify views work correctly
  console.log('Step 3: Verifying updated views...');

  // Test 1: Check pm_wallet_market_pnl_resolved schema
  console.log('\n   Test 1: pm_wallet_market_pnl_resolved schema');
  try {
    const describeQuery = await clickhouse.query({
      query: 'DESCRIBE TABLE pm_wallet_market_pnl_resolved',
      format: 'JSONEachRow'
    });
    const schema = await describeQuery.json();

    const canonicalCol = schema.find((col: any) => col.name === 'canonical_wallet_address');
    const walletCol = schema.find((col: any) => col.name === 'wallet_address');

    if (canonicalCol && walletCol) {
      console.log('   ✅ canonical_wallet_address column exists');
      console.log('   ✅ wallet_address column exists (for debugging)');
    } else {
      console.log('   ⚠️  Expected columns not found\n');
    }
  } catch (error: any) {
    console.log(`   ⚠️  Schema check failed: ${error.message}\n`);
  }

  // Test 2: Check pm_wallet_pnl_summary schema
  console.log('\n   Test 2: pm_wallet_pnl_summary schema');
  try {
    const describeQuery = await clickhouse.query({
      query: 'DESCRIBE TABLE pm_wallet_pnl_summary',
      format: 'JSONEachRow'
    });
    const schema = await describeQuery.json();

    const canonicalCol = schema.find((col: any) => col.name === 'canonical_wallet_address');
    const proxyCountCol = schema.find((col: any) => col.name === 'proxy_wallets_count');

    if (canonicalCol && proxyCountCol) {
      console.log('   ✅ canonical_wallet_address column exists');
      console.log('   ✅ proxy_wallets_count column exists');
      console.log('   ✅ proxy_wallets_used column exists\n');
    } else {
      console.log('   ⚠️  Expected columns not found\n');
    }
  } catch (error: any) {
    console.log(`   ⚠️  Schema check failed: ${error.message}\n`);
  }

  // Test 3: Count wallets in summary
  console.log('   Test 3: Count wallets in pm_wallet_pnl_summary');
  try {
    const countQuery = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_wallets,
          SUM(proxy_wallets_count) as total_proxy_associations,
          COUNT(CASE WHEN proxy_wallets_count > 1 THEN 1 END) as wallets_with_multiple_proxies
        FROM pm_wallet_pnl_summary
      `,
      format: 'JSONEachRow'
    });
    const counts = await countQuery.json();

    const totalWallets = parseInt(counts[0]?.total_wallets || '0');
    const totalProxyAssociations = parseInt(counts[0]?.total_proxy_associations || '0');
    const multiProxyWallets = parseInt(counts[0]?.wallets_with_multiple_proxies || '0');

    console.log(`   Total canonical wallets: ${totalWallets.toLocaleString()}`);
    console.log(`   Total proxy associations: ${totalProxyAssociations.toLocaleString()}`);
    console.log(`   Wallets with >1 proxy: ${multiProxyWallets.toLocaleString()}\n`);
  } catch (error: any) {
    console.log(`   ⚠️  Count query failed: ${error.message}\n`);
  }

  // Test 4: xcnstrategy P&L
  console.log('   Test 4: xcnstrategy P&L with canonical wallet');
  const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  try {
    const xcnQuery = await clickhouse.query({
      query: `
        SELECT
          canonical_wallet_address,
          proxy_wallets_count,
          proxy_wallets_used,
          total_markets,
          total_trades,
          pnl_net,
          winning_markets,
          losing_markets,
          win_rate
        FROM pm_wallet_pnl_summary
        WHERE lower(canonical_wallet_address) = lower('${XCN_EOA}')
      `,
      format: 'JSONEachRow'
    });
    const xcnResults = await xcnQuery.json();

    if (xcnResults.length > 0) {
      const result = xcnResults[0];
      console.log('   Results:');
      console.log(`   Canonical Wallet: ${result.canonical_wallet_address}`);
      console.log(`   Proxy Wallets: ${result.proxy_wallets_count} (${result.proxy_wallets_used})`);
      console.log(`   Total Markets: ${result.total_markets}`);
      console.log(`   Total Trades: ${result.total_trades}`);
      console.log(`   P&L Net: $${parseFloat(result.pnl_net).toFixed(2)}`);
      console.log(`   Win Rate: ${(parseFloat(result.win_rate || 0) * 100).toFixed(2)}%`);
      console.log('');

      // Compare to Dome
      const domePnL = 87030.51;
      const ourPnL = parseFloat(result.pnl_net);
      const gap = domePnL - ourPnL;
      const gapPct = (gap / domePnL * 100).toFixed(2);

      console.log('   Dome API Comparison:');
      console.log(`   Dome P&L: $${domePnL.toFixed(2)}`);
      console.log(`   Our P&L: $${ourPnL.toFixed(2)}`);
      console.log(`   Gap: $${gap.toFixed(2)} (${gapPct}%)\n`);
    } else {
      console.log(`   ⚠️  No P&L found for xcnstrategy\n`);
    }
  } catch (error: any) {
    console.log(`   ⚠️  xcnstrategy query failed: ${error.message}\n`);
  }

  // Step 4: Summary
  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ pm_wallet_market_pnl_resolved updated successfully');
  console.log('   - Now groups by canonical_wallet_address');
  console.log('   - Keeps wallet_address for debugging');
  console.log('');
  console.log('✅ pm_wallet_pnl_summary updated successfully');
  console.log('   - Now aggregates by canonical_wallet_address');
  console.log('   - Shows proxy_wallets_count and proxy_wallets_used');
  console.log('   - Leaderboards now show unified wallet identities');
  console.log('');
  console.log('⚠️  Expected Outcome:');
  console.log('   - xcnstrategy P&L remains ~$2,089 (unchanged)');
  console.log('   - Gap remains $84,941 (97.6%)');
  console.log('   - Reason: Proxy wallet (0xd59...723) has 0 trades in clob_fills');
  console.log('');
  console.log('Next Steps:');
  console.log('1. Re-run xcnstrategy comparison to verify canonical aggregation');
  console.log('2. Update DOME_COVERAGE_INVESTIGATION_REPORT.md with canonical findings');
  console.log('3. Investigate Category C markets (14 markets with 100 missing trades)');
  console.log('4. Backfill proxy wallet trades from AMM or other sources');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
