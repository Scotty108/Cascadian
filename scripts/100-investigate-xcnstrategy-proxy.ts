#!/usr/bin/env tsx
/**
 * Investigate xcnstrategy Proxy Wallet PnL
 *
 * Dome reports $87K PnL for xcnstrategy, but we only have $2K.
 * Hypothesis: Trading happens through proxy wallet 0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

async function main() {
  console.log('🔍 Investigating xcnstrategy Proxy Wallet');
  console.log('='.repeat(60));
  console.log('');
  console.log(`EOA:   ${XCN_EOA}`);
  console.log(`Proxy: ${XCN_PROXY}`);
  console.log('');
  console.log('Dome API reported: $87,030.51 total PnL');
  console.log('ClickHouse (EOA):  $2,089.18 total PnL');
  console.log('Difference:        $84,941.33 (42x)');
  console.log('');

  // Check if we have any data for the proxy wallet
  console.log('Step 1: Checking for proxy wallet in pm_trades...');
  const proxyTradesQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT condition_id) as markets,
        SUM(shares) as total_shares,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade
      FROM pm_trades
      WHERE wallet_address = '${XCN_PROXY}'
    `,
    format: 'JSONEachRow'
  });

  const proxyTrades = await proxyTradesQuery.json();
  console.log('');
  console.log('Proxy Wallet in pm_trades:');
  console.table(proxyTrades);
  console.log('');

  // Check EOA for comparison
  console.log('Step 2: Checking EOA wallet in pm_trades...');
  const eoaTradesQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT condition_id) as markets,
        SUM(shares) as total_shares,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade
      FROM pm_trades
      WHERE wallet_address = '${XCN_EOA}'
    `,
    format: 'JSONEachRow'
  });

  const eoaTrades = await eoaTradesQuery.json();
  console.log('');
  console.log('EOA Wallet in pm_trades:');
  console.table(eoaTrades);
  console.log('');

  // Check PnL for proxy if it has trades
  const proxyTradeCount = parseInt(proxyTrades[0]?.total_trades || '0');

  if (proxyTradeCount > 0) {
    console.log('Step 3: Calculating PnL for proxy wallet...');

    const proxyPnlQuery = await clickhouse.query({
      query: `
        SELECT
          SUM(pnl_net) as pnl_net_proxy,
          COUNT(DISTINCT condition_id) as markets_count,
          SUM(gross_notional) as gross_notional,
          SUM(total_trades) as total_trades
        FROM pm_wallet_market_pnl_resolved
        WHERE wallet_address = '${XCN_PROXY}'
      `,
      format: 'JSONEachRow'
    });

    const proxyPnl = await proxyPnlQuery.json();
    console.log('');
    console.log('Proxy Wallet PnL:');
    console.table(proxyPnl);
    console.log('');

    // Calculate combined PnL (EOA + Proxy)
    const eoaPnl = 2089.18; // From our earlier query
    const proxyPnlValue = parseFloat(proxyPnl[0]?.pnl_net_proxy || '0');
    const combinedPnl = eoaPnl + proxyPnlValue;

    console.log('='.repeat(60));
    console.log('📊 COMBINED PNL ANALYSIS');
    console.log('='.repeat(60));
    console.log('');
    console.log(`EOA PnL:      $${eoaPnl.toLocaleString()}`);
    console.log(`Proxy PnL:    $${proxyPnlValue.toLocaleString()}`);
    console.log(`Combined PnL: $${combinedPnl.toLocaleString()}`);
    console.log('');
    console.log(`Dome PnL:     $87,030.51`);
    console.log(`Difference:   $${(87030.51 - combinedPnl).toLocaleString()}`);
    console.log(`Match %:      ${(combinedPnl / 87030.51 * 100).toFixed(2)}%`);
    console.log('');

  } else {
    console.log('⚠️  No trades found for proxy wallet in pm_trades');
    console.log('');
    console.log('Possible explanations:');
    console.log('1. Proxy trades under different address');
    console.log('2. AMM trades not in CLOB data');
    console.log('3. ERC-1155 transfers not in pm_trades');
    console.log('4. Categorical markets (not in binary filter)');
    console.log('');
  }

  // Check if there are unresolved markets for EOA
  console.log('Step 4: Checking for unresolved markets (EOA)...');
  const unresolvedQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT t.condition_id) as unresolved_markets,
        SUM(t.shares) as total_shares_unresolved
      FROM pm_trades t
      LEFT JOIN pm_markets m
        ON t.condition_id = m.condition_id
      WHERE t.wallet_address = '${XCN_EOA}'
        AND (m.status != 'resolved' OR m.status IS NULL)
    `,
    format: 'JSONEachRow'
  });

  const unresolved = await unresolvedQuery.json();
  console.log('');
  console.log('Unresolved Markets (EOA):');
  console.table(unresolved);
  console.log('');

  console.log('='.repeat(60));
  console.log('🎯 HYPOTHESIS RESULTS');
  console.log('='.repeat(60));
  console.log('');

  if (proxyTradeCount > 0) {
    console.log('✅ Proxy wallet FOUND in our data');
    console.log('   - Investigating proxy PnL contribution');
  } else {
    console.log('❌ Proxy wallet NOT found in pm_trades');
    console.log('   - This explains the discrepancy');
    console.log('   - Safe multisig proxies may use different addresses');
    console.log('   - Need to map proxy → EOA relationships');
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Investigation failed:', error);
  process.exit(1);
});
