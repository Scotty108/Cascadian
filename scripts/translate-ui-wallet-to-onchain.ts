#!/usr/bin/env npx tsx

/**
 * Translate Polymarket UI Wallet → On-Chain Wallet → Metrics
 *
 * Usage: npx tsx translate-ui-wallet-to-onchain.ts <ui_wallet>
 * Example: npx tsx translate-ui-wallet-to-onchain.ts 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

interface PolymarketPosition {
  user: string;
  proxyWallet: string;
  market: {
    condition_id: string;
    question: string;
    outcomes: string[];
  };
  size: number;
  pnl: number;
  entry_price: number;
  current_price: number;
}

interface WalletMapping {
  ui_wallet: string;
  proxy_wallet: string;
  username?: string;
  display_name?: string;
  profile_slug?: string;
}

interface GammaProfile {
  wallet: string;
  username: string;
  slug: string;
  displayName?: string;
}

async function fetchPolymarketMapping(uiWallet: string): Promise<WalletMapping | null> {
  console.log('=== STEP 1: Fetch Polymarket API Mapping ===\n');

  const url = `https://data-api.polymarket.com/positions?user=${uiWallet}`;
  console.log(`Calling: ${url}\n`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`❌ API Error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.warn('⚠️  No positions found for this wallet.');
      console.warn('   Wallet may have no active positions, or UI wallet = on-chain wallet.\n');

      // Try to use UI wallet as proxy wallet if no positions
      return {
        ui_wallet: uiWallet.toLowerCase(),
        proxy_wallet: uiWallet.toLowerCase(),
        username: undefined,
        display_name: undefined,
        profile_slug: undefined
      };
    }

    // Extract mapping from first position
    const first = data[0] as PolymarketPosition;

    // Handle case where user is null (wallet trades directly, no proxy)
    const userWallet = first.user ? first.user.toLowerCase() : uiWallet.toLowerCase();
    const proxyWallet = first.proxyWallet ? first.proxyWallet.toLowerCase() : uiWallet.toLowerCase();

    const mapping: WalletMapping = {
      ui_wallet: userWallet,
      proxy_wallet: proxyWallet,
      username: undefined,
      display_name: undefined,
      profile_slug: undefined
    };

    console.log('✅ Mapping found:');
    console.log(`   UI Wallet:      ${mapping.ui_wallet}`);
    console.log(`   Proxy Wallet:   ${mapping.proxy_wallet}`);
    console.log(`   Active positions: ${data.length}\n`);

    if (mapping.ui_wallet === mapping.proxy_wallet) {
      console.log('ℹ️  UI wallet = Proxy wallet (no proxy architecture for this wallet)\n');
    }

    return mapping;
  } catch (error: any) {
    console.error(`❌ Error fetching from Data API: ${error.message}\n`);
    return null;
  }
}

async function fetchGammaProfile(wallet: string): Promise<GammaProfile | null> {
  console.log('=== STEP 2: Fetch Gamma Profile (Optional) ===\n');

  const url = `https://gamma-api.polymarket.com/user-profile?wallet=${wallet}`;
  console.log(`Calling: ${url}\n`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`⚠️  Gamma API returned ${response.status} (profile may not exist)\n`);
      return null;
    }

    const profile = await response.json();

    if (!profile.username) {
      console.warn('⚠️  No username found in Gamma profile\n');
      return null;
    }

    console.log('✅ Profile found:');
    console.log(`   Username: ${profile.username}`);
    console.log(`   Slug: ${profile.slug || 'N/A'}`);
    console.log(`   Display Name: ${profile.displayName || 'N/A'}\n`);

    return profile as GammaProfile;
  } catch (error: any) {
    console.warn(`⚠️  Error fetching Gamma profile: ${error.message}\n`);
    return null;
  }
}

async function queryClickHouseMetrics(proxyWallet: string) {
  console.log('=== STEP 3: Query ClickHouse for On-Chain Metrics ===\n');
  console.log(`Querying with proxy wallet: ${proxyWallet}\n`);

  // Basic stats
  const statsQuery = `
    SELECT
      count() as total_trades,
      uniqExact(lower(replaceAll(condition_id, '0x', ''))) as unique_markets,
      sum(toFloat64(cashflow_usdc)) as total_cashflow,
      min(block_time) as first_trade,
      max(block_time) as last_trade
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
  `;

  const statsResult = await clickhouse.query({
    query: statsQuery,
    format: 'JSONEachRow',
    query_params: { wallet: proxyWallet }
  });
  const stats = await statsResult.json<Array<any>>();

  if (stats[0].total_trades === '0') {
    console.log('❌ No trades found in database for this proxy wallet.\n');
    console.log('Possible reasons:');
    console.log('  - Database is stale or incomplete');
    console.log('  - Wallet has only traded on markets not in our dataset');
    console.log('  - Mapping is incorrect\n');
    return null;
  }

  console.log('--- Basic Stats ---\n');
  console.log(`  Total Trades:    ${parseInt(stats[0].total_trades).toLocaleString()}`);
  console.log(`  Unique Markets:  ${parseInt(stats[0].unique_markets).toLocaleString()}`);
  console.log(`  Total Cashflow:  $${parseFloat(stats[0].total_cashflow).toFixed(2)}`);
  console.log(`  First Trade:     ${stats[0].first_trade}`);
  console.log(`  Last Trade:      ${stats[0].last_trade}\n`);

  // P&L calculation
  console.log('--- P&L Calculation ---\n');

  const pnlQuery = `
    WITH trades_with_resolutions AS (
      SELECT
        t.wallet,
        lower(replaceAll(t.condition_id, '0x', '')) as cid_norm,
        t.outcome_index,
        t.trade_direction,
        toFloat64(t.shares) as shares,
        toFloat64(t.cashflow_usdc) as cashflow_usdc,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index
      FROM default.trades_raw t
      LEFT JOIN default.market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE lower(t.wallet) = lower({wallet:String})
        AND length(replaceAll(t.condition_id, '0x', '')) = 64
    ),
    realized_pnl AS (
      SELECT sum(cashflow_usdc) as realized
      FROM trades_with_resolutions
    ),
    unrealized_pnl AS (
      SELECT
        sum(
          if(trade_direction = 'BUY', shares, -shares) *
          (arrayElement(payout_numerators, winning_index + 1) / payout_denominator)
        ) as unrealized
      FROM trades_with_resolutions
      WHERE winning_index IS NOT NULL
    )
    SELECT
      r.realized,
      u.unrealized,
      r.realized + coalesce(u.unrealized, 0) as total_pnl
    FROM realized_pnl r, unrealized_pnl u
  `;

  const pnlResult = await clickhouse.query({
    query: pnlQuery,
    format: 'JSONEachRow',
    query_params: { wallet: proxyWallet }
  });
  const pnl = await pnlResult.json<Array<any>>();

  const realized = parseFloat(pnl[0].realized || 0);
  const unrealized = parseFloat(pnl[0].unrealized || 0);
  const total = parseFloat(pnl[0].total_pnl || 0);

  console.log(`  Realized P&L:    $${realized.toFixed(2)}`);
  console.log(`  Unrealized P&L:  $${unrealized.toFixed(2)}`);
  console.log(`  Total P&L:       $${total.toFixed(2)}\n`);

  // Resolution coverage
  const coverageQuery = `
    SELECT
      countIf(r.condition_id_norm IS NOT NULL) as resolved_count,
      count() as total_markets
    FROM (
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
      FROM default.trades_raw
      WHERE lower(wallet) = lower({wallet:String})
        AND length(replaceAll(condition_id, '0x', '')) = 64
    ) t
    LEFT JOIN default.market_resolutions_final r
      ON t.cid_norm = r.condition_id_norm
  `;

  const coverageResult = await clickhouse.query({
    query: coverageQuery,
    format: 'JSONEachRow',
    query_params: { wallet: proxyWallet }
  });
  const coverage = await coverageResult.json<Array<any>>();

  const resolvedCount = parseInt(coverage[0].resolved_count || 0);
  const totalMarkets = parseInt(coverage[0].total_markets || 0);
  const coveragePct = totalMarkets > 0 ? (resolvedCount / totalMarkets * 100).toFixed(2) : '0.00';

  console.log('--- Resolution Coverage ---\n');
  console.log(`  Resolved Markets: ${resolvedCount} / ${totalMarkets} (${coveragePct}%)\n`);

  return {
    total_trades: parseInt(stats[0].total_trades),
    unique_markets: parseInt(stats[0].unique_markets),
    total_cashflow: parseFloat(stats[0].total_cashflow),
    first_trade: stats[0].first_trade,
    last_trade: stats[0].last_trade,
    realized_pnl: realized,
    unrealized_pnl: unrealized,
    total_pnl: total,
    resolved_markets: resolvedCount,
    total_markets: totalMarkets,
    coverage_pct: parseFloat(coveragePct)
  };
}

async function storeMapping(mapping: WalletMapping) {
  console.log('=== STEP 4: Store Mapping in ClickHouse ===\n');

  try {
    // Check if table exists
    const checkTableQuery = `
      SELECT count() as exists
      FROM system.tables
      WHERE database = 'default' AND name = 'wallet_ui_map'
    `;
    const checkResult = await clickhouse.query({
      query: checkTableQuery,
      format: 'JSONEachRow'
    });
    const tableCheck = await checkResult.json<Array<{ exists: string }>>();

    if (tableCheck[0].exists === '0') {
      // Create table
      console.log('Creating wallet_ui_map table...\n');
      await clickhouse.command({
        query: `
          CREATE TABLE IF NOT EXISTS default.wallet_ui_map (
            ui_wallet String,
            proxy_wallet String,
            username Nullable(String),
            display_name Nullable(String),
            profile_slug Nullable(String),
            fetched_at DateTime DEFAULT now()
          )
          ENGINE = ReplacingMergeTree(fetched_at)
          ORDER BY ui_wallet
        `
      });
      console.log('✅ Table created\n');
    }

    // Insert or update mapping
    await clickhouse.insert({
      table: 'wallet_ui_map',
      values: [{
        ui_wallet: mapping.ui_wallet,
        proxy_wallet: mapping.proxy_wallet,
        username: mapping.username || null,
        display_name: mapping.display_name || null,
        profile_slug: mapping.profile_slug || null
      }],
      format: 'JSONEachRow'
    });

    console.log('✅ Mapping stored in default.wallet_ui_map\n');
  } catch (error: any) {
    console.warn(`⚠️  Failed to store mapping: ${error.message}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx translate-ui-wallet-to-onchain.ts <ui_wallet>');
    console.error('Example: npx tsx translate-ui-wallet-to-onchain.ts 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
    process.exit(1);
  }

  const uiWallet = args[0].toLowerCase();

  console.log('=== POLYMARKET UI WALLET → ON-CHAIN TRANSLATOR ===\n');
  console.log(`Input UI Wallet: ${uiWallet}\n`);

  // Step 1: Fetch mapping from Polymarket Data API
  const mapping = await fetchPolymarketMapping(uiWallet);
  if (!mapping) {
    console.error('❌ Failed to fetch wallet mapping from Polymarket API\n');
    process.exit(1);
  }

  // Step 2: Fetch profile from Gamma API (optional, for display name)
  const profile = await fetchGammaProfile(uiWallet);
  if (profile) {
    mapping.username = profile.username;
    mapping.display_name = profile.displayName;
    mapping.profile_slug = profile.slug;
  }

  // Step 3: Query ClickHouse for metrics using proxy wallet
  const metrics = await queryClickHouseMetrics(mapping.proxy_wallet);

  // Step 4: Store mapping for future use
  await storeMapping(mapping);

  // Final summary
  console.log('=== SUMMARY ===\n');
  console.log(`UI Wallet:        ${mapping.ui_wallet}`);
  console.log(`Proxy Wallet:     ${mapping.proxy_wallet}`);
  if (mapping.username) {
    console.log(`Username:         ${mapping.username}`);
  }
  if (mapping.profile_slug) {
    console.log(`Profile URL:      https://polymarket.com/profile/${mapping.profile_slug}`);
  }
  console.log();

  if (metrics) {
    console.log('Database Metrics:');
    console.log(`  Total Trades:     ${metrics.total_trades.toLocaleString()}`);
    console.log(`  Unique Markets:   ${metrics.unique_markets.toLocaleString()}`);
    console.log(`  Total P&L:        $${metrics.total_pnl.toFixed(2)}`);
    console.log(`  Resolution Coverage: ${metrics.coverage_pct}%`);
    console.log();
  }

  console.log('✅ Translation complete!\n');
}

main().catch(console.error);
