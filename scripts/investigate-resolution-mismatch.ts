#!/usr/bin/env tsx
/**
 * Investigate why only 8.2% of positions are resolved
 * when 99.96% of markets globally have resolution data
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 INVESTIGATING RESOLUTION MISMATCH');
  console.log('═'.repeat(80));

  // 1. Check wallet 0x4ce7 actual trade count
  console.log('\n📊 Step 1: Verify wallet 0x4ce7 trade count...');

  const walletTrades = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT lower(replaceAll(cid, '0x', ''))) as unique_markets,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = '${TEST_WALLET}'
    `,
    format: 'JSONEachRow',
  });

  const wStats = await walletTrades.json();
  console.log('\nWallet 0x4ce7 actual stats:');
  console.log(JSON.stringify(wStats[0], null, 2));

  // 2. Check distribution of unresolved positions
  console.log('\n📊 Step 2: Analyzing unresolved position distribution...');

  const distribution = await ch.query({
    query: `
      WITH position_status AS (
        SELECT
          tp.condition_id,
          COUNT(*) as num_positions,
          CASE
            WHEN r.payout_denominator > 0 THEN 'RESOLVED'
            WHEN r.payout_denominator = 0 THEN 'ZERO_DENOMINATOR'
            WHEN r.condition_id_norm IS NULL THEN 'NO_RESOLUTION_RECORD'
            ELSE 'UNKNOWN'
          END as status
        FROM (
          SELECT DISTINCT
            lower(replaceAll(cid, '0x', '')) as condition_id
          FROM default.fact_trades_clean
        ) tp
        LEFT JOIN default.market_resolutions_final r
          ON tp.condition_id = r.condition_id_norm
        GROUP BY tp.condition_id, status
      )
      SELECT
        status,
        COUNT(*) as num_markets,
        SUM(num_positions) as total_positions
      FROM position_status
      GROUP BY status
      ORDER BY num_markets DESC
    `,
    format: 'JSONEachRow',
  });

  const dist = await distribution.json();
  console.log('\nPosition distribution by status:');
  dist.forEach((d: any) => {
    console.log(`  ${d.status}: ${d.num_markets} markets, ${d.total_positions} positions`);
  });

  // 3. Check if the issue is with the view's join logic
  console.log('\n📊 Step 3: Checking view join logic...');

  const viewStats = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(DISTINCT wallet) as total_wallets,
        COUNT(DISTINCT condition_id) as total_markets,
        SUM(CASE WHEN realized_pnl_usd IS NOT NULL THEN 1 ELSE 0 END) as resolved_positions,
        SUM(CASE WHEN realized_pnl_usd IS NULL THEN 1 ELSE 0 END) as unresolved_positions
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow',
  });

  const vStats = await viewStats.json();
  console.log('\nView statistics:');
  console.log(JSON.stringify(vStats[0], null, 2));

  // 4. Sample unresolved positions to understand why
  console.log('\n📊 Step 4: Sampling unresolved positions...');

  const unresolvedSample = await ch.query({
    query: `
      SELECT
        condition_id,
        COUNT(*) as num_wallets_with_position,
        SUM(num_trades) as total_trades_in_market,
        MIN(first_trade) as earliest_trade,
        MAX(last_trade) as latest_trade,
        payout_denominator
      FROM default.vw_wallet_pnl_calculated
      WHERE realized_pnl_usd IS NULL
      GROUP BY condition_id, payout_denominator
      ORDER BY num_wallets_with_position DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const unresolvedMarkets = await unresolvedSample.json();
  console.log('\nTop 10 unresolved markets by wallet count:');
  unresolvedMarkets.forEach((m: any, i: number) => {
    console.log(`\n${i + 1}. CID: ${m.condition_id.substring(0, 16)}...`);
    console.log(`   Wallets with position: ${m.num_wallets_with_position}`);
    console.log(`   Total trades: ${m.total_trades_in_market}`);
    console.log(`   Trade period: ${m.earliest_trade} to ${m.latest_trade}`);
    console.log(`   Payout denominator: ${m.payout_denominator}`);
  });

  // 5. Check if these are actually recent/active markets
  console.log('\n📊 Step 5: Checking if unresolved positions are from recent markets...');

  const recentCheck = await ch.query({
    query: `
      SELECT
        CASE
          WHEN last_trade >= NOW() - INTERVAL 7 DAY THEN 'Last 7 days'
          WHEN last_trade >= NOW() - INTERVAL 30 DAY THEN 'Last 30 days'
          WHEN last_trade >= NOW() - INTERVAL 90 DAY THEN 'Last 90 days'
          ELSE 'Older than 90 days'
        END as period,
        COUNT(DISTINCT condition_id) as num_markets,
        COUNT(*) as num_positions
      FROM default.vw_wallet_pnl_calculated
      WHERE realized_pnl_usd IS NULL
      GROUP BY period
      ORDER BY period
    `,
    format: 'JSONEachRow',
  });

  const recency = await recentCheck.json();
  console.log('\nUnresolved positions by last trade date:');
  recency.forEach((r: any) => {
    console.log(`  ${r.period}: ${r.num_markets} markets, ${r.num_positions} positions`);
  });

  // 6. Compare with resolved positions timing
  console.log('\n📊 Step 6: Comparing with resolved positions timing...');

  const resolvedTiming = await ch.query({
    query: `
      SELECT
        CASE
          WHEN last_trade >= NOW() - INTERVAL 7 DAY THEN 'Last 7 days'
          WHEN last_trade >= NOW() - INTERVAL 30 DAY THEN 'Last 30 days'
          WHEN last_trade >= NOW() - INTERVAL 90 DAY THEN 'Last 90 days'
          ELSE 'Older than 90 days'
        END as period,
        COUNT(DISTINCT condition_id) as num_markets,
        COUNT(*) as num_positions
      FROM default.vw_wallet_pnl_calculated
      WHERE realized_pnl_usd IS NOT NULL
      GROUP BY period
      ORDER BY period
    `,
    format: 'JSONEachRow',
  });

  const resolvedRec = await resolvedTiming.json();
  console.log('\nResolved positions by last trade date:');
  resolvedRec.forEach((r: any) => {
    console.log(`  ${r.period}: ${r.num_markets} markets, ${r.num_positions} positions`);
  });

  console.log('\n' + '═'.repeat(80));
  console.log('✅ INVESTIGATION COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
