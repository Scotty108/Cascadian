#!/usr/bin/env tsx
/**
 * Create SQL-based P&L views using existing ClickHouse data
 * No API calls needed - calculates from 63M trades + 157K payouts
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

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🚀 CREATING SQL-BASED P&L VIEWS');
  console.log('   Using existing 63M trades + 157K payouts');
  console.log('═'.repeat(80));

  // Step 1: Create calculated P&L view
  console.log('\n📊 Step 1: Creating vw_wallet_pnl_calculated...');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW default.vw_wallet_pnl_calculated AS
      WITH trade_positions AS (
        SELECT
          lower(wallet_address) as wallet,
          lower(replaceAll(cid, '0x', '')) as condition_id,  -- Strip 0x prefix to match market_resolutions
          outcome_index,
          -- Net shares (buys - sells)
          SUM(CASE
            WHEN direction = 'BUY' THEN shares
            WHEN direction = 'SELL' THEN -shares
            ELSE 0
          END) as net_shares,
          -- Cost basis (spent on buys - received on sells)
          SUM(CASE
            WHEN direction = 'BUY' THEN usdc_amount
            WHEN direction = 'SELL' THEN -usdc_amount
            ELSE 0
          END) as cost_basis,
          MIN(block_time) as first_trade,
          MAX(block_time) as last_trade,
          COUNT(*) as num_trades
        FROM default.fact_trades_clean
        WHERE direction IN ('BUY', 'SELL')
          AND shares > 0
        GROUP BY wallet, condition_id, outcome_index
        HAVING net_shares != 0 OR cost_basis != 0
      ),
      positions_with_payouts AS (
        SELECT
          tp.*,
          r.payout_numerators,
          r.payout_denominator,
          r.winning_outcome,
          -- Calculate realized P&L using payout vector
          CASE
            WHEN r.payout_denominator > 0 AND length(r.payout_numerators) > tp.outcome_index THEN
              (tp.net_shares * r.payout_numerators[tp.outcome_index + 1] / r.payout_denominator) - tp.cost_basis
            ELSE
              NULL -- Unresolved market
          END as realized_pnl_usd
        FROM trade_positions tp
        LEFT JOIN default.market_resolutions_final r
          ON tp.condition_id = r.condition_id_norm
      )
      SELECT
        wallet,
        condition_id,
        outcome_index,
        net_shares,
        cost_basis,
        realized_pnl_usd,
        first_trade,
        last_trade,
        num_trades,
        payout_numerators,
        payout_denominator,
        winning_outcome
      FROM positions_with_payouts
      ORDER BY wallet, condition_id
    `,
  });

  console.log('  ✅ Created vw_wallet_pnl_calculated');

  // Step 2: Create summary view
  console.log('\n📊 Step 2: Creating vw_wallet_pnl_summary...');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW default.vw_wallet_pnl_summary AS
      SELECT
        wallet,
        COUNT(DISTINCT condition_id) as total_markets,
        COUNT(DISTINCT CASE WHEN realized_pnl_usd IS NOT NULL THEN condition_id END) as resolved_markets,
        COUNT(DISTINCT CASE WHEN realized_pnl_usd IS NULL THEN condition_id END) as unresolved_markets,
        SUM(realized_pnl_usd) as total_pnl_usd,
        SUM(CASE WHEN realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) as total_wins_usd,
        SUM(CASE WHEN realized_pnl_usd < 0 THEN realized_pnl_usd ELSE 0 END) as total_losses_usd,
        SUM(cost_basis) as total_volume_usd,
        MIN(first_trade) as first_trade_date,
        MAX(last_trade) as last_trade_date,
        SUM(num_trades) as total_trades
      FROM default.vw_wallet_pnl_calculated
      GROUP BY wallet
      ORDER BY total_pnl_usd DESC
    `,
  });

  console.log('  ✅ Created vw_wallet_pnl_summary');

  // Step 3: Test on wallet 0x4ce7
  console.log('\n🧪 Step 3: Testing on wallet 0x4ce7...');

  const testResult = await ch.query({
    query: `
      SELECT *
      FROM default.vw_wallet_pnl_summary
      WHERE wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
    `,
    format: 'JSONEachRow',
  });

  const summary = await testResult.json();

  if (summary.length > 0) {
    console.log('\n📊 Wallet 0x4ce7 P&L Summary:');
    console.log(JSON.stringify(summary[0], null, 2));
  } else {
    console.log('  ⚠️  No data found for wallet 0x4ce7 (might need case normalization)');
  }

  // Step 4: Get market-level detail
  console.log('\n📊 Step 4: Sample market-level P&L for 0x4ce7...');

  const detailResult = await ch.query({
    query: `
      SELECT
        condition_id,
        outcome_index,
        net_shares,
        cost_basis,
        realized_pnl_usd,
        num_trades
      FROM default.vw_wallet_pnl_calculated
      WHERE wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
      ORDER BY realized_pnl_usd DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const markets = await detailResult.json();

  console.log('\n📝 Top 5 markets by P&L:');
  markets.forEach((m: any, i: number) => {
    console.log(`  ${i + 1}. CID: ${m.condition_id.substring(0, 16)}...`);
    console.log(`     Net shares: ${m.net_shares}, Cost: $${m.cost_basis}, P&L: $${m.realized_pnl_usd || 'unresolved'}`);
    console.log(`     Trades: ${m.num_trades}`);
  });

  // Step 5: Overall statistics
  console.log('\n📊 Step 5: Overall coverage statistics...');

  const statsResult = await ch.query({
    query: `
      SELECT
        COUNT(DISTINCT wallet) as total_wallets,
        COUNT(DISTINCT condition_id) as total_markets,
        SUM(num_trades) as total_trades,
        SUM(realized_pnl_usd) as total_pnl,
        COUNT(DISTINCT CASE WHEN realized_pnl_usd IS NOT NULL THEN condition_id END) as resolved_markets,
        COUNT(DISTINCT CASE WHEN realized_pnl_usd IS NULL THEN condition_id END) as unresolved_markets
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow',
  });

  const stats = await statsResult.json();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ SQL-BASED P&L VIEWS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\nCoverage Statistics:');
  console.log(JSON.stringify(stats[0], null, 2));
  console.log('\n✅ Views created successfully!');
  console.log('\nNext steps:');
  console.log('  1. Query vw_wallet_pnl_summary for any wallet');
  console.log('  2. Query vw_wallet_pnl_calculated for market-level detail');
  console.log('  3. Identify top wallets needing historical backfill (optional)');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
