#!/usr/bin/env tsx
/**
 * Build pm_wallet_pnl_summary View - Wallet-Level P&L Summary
 *
 * Aggregates pm_wallet_market_pnl_resolved to wallet level.
 * Provides total P&L, win rates, and position sizing metrics per wallet.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Building pm_wallet_pnl_summary View');
  console.log('='.repeat(60));
  console.log('');

  console.log('Source: pm_wallet_market_pnl_resolved');
  console.log('Aggregation: Per wallet_address');
  console.log('');

  console.log('Step 1: Dropping existing pm_wallet_pnl_summary view if exists...');
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_wallet_pnl_summary'
  });
  console.log('✅ Old view dropped');
  console.log('');

  console.log('Step 2: Creating pm_wallet_pnl_summary view...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE VIEW pm_wallet_pnl_summary AS
      WITH wallet_aggregates AS (
        SELECT
          w.wallet_address,
          COUNT(DISTINCT w.condition_id) as total_markets,
          SUM(w.total_trades) as total_trades,
          SUM(w.gross_notional) as gross_notional,
          SUM(w.net_notional) as net_notional,
          SUM(w.fees_paid) as fees_paid,
          SUM(w.pnl_gross) as pnl_gross,
          SUM(w.pnl_net) as pnl_net,
          COUNT(DISTINCT CASE
            WHEN w.is_winning_outcome = 1 AND w.pnl_net > 0.0
            THEN w.condition_id
          END) as winning_markets,
          COUNT(DISTINCT CASE
            WHEN w.is_winning_outcome = 1 AND w.pnl_net < 0.0
            THEN w.condition_id
          END) as losing_markets
        FROM pm_wallet_market_pnl_resolved w
        GROUP BY w.wallet_address
      )
      SELECT
        wallet_address,
        total_markets,
        total_trades,
        gross_notional,
        net_notional,
        fees_paid,
        pnl_gross,
        pnl_net,
        winning_markets,
        losing_markets,
        winning_markets + losing_markets as markets_with_result,
        IF(
          winning_markets + losing_markets > 0,
          winning_markets / (winning_markets + losing_markets),
          NULL
        ) as win_rate,
        IF(
          total_trades > 0,
          gross_notional / total_trades,
          NULL
        ) as avg_position_size,
        'pm_wallet_market_pnl_resolved_v1' as data_source
      FROM wallet_aggregates
    `
  });

  console.log('✅ pm_wallet_pnl_summary view created');
  console.log('');

  // Get quick stats
  console.log('Step 3: Gathering statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_wallets,
        COUNT(CASE WHEN pnl_net > 0 THEN 1 END) as profitable_wallets,
        COUNT(CASE WHEN pnl_net < 0 THEN 1 END) as unprofitable_wallets,
        COUNT(CASE WHEN pnl_net = 0 THEN 1 END) as breakeven_wallets,
        ROUND(SUM(pnl_net), 2) as total_pnl_net,
        ROUND(SUM(fees_paid), 2) as total_fees,
        ROUND(AVG(total_markets), 2) as avg_markets_per_wallet,
        ROUND(AVG(win_rate), 4) as avg_win_rate
      FROM pm_wallet_pnl_summary
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('pm_wallet_pnl_summary Statistics:');
  console.table(stats);
  console.log('');

  // Sample wallets
  console.log('Step 4: Sample wallets (top 10 by pnl_net)...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(wallet_address, 1, 10) || '...' as wallet_short,
        total_markets,
        total_trades,
        ROUND(gross_notional, 2) as gross_notional,
        ROUND(fees_paid, 2) as fees_paid,
        ROUND(pnl_net, 2) as pnl_net,
        winning_markets,
        losing_markets,
        ROUND(win_rate, 4) as win_rate,
        ROUND(avg_position_size, 2) as avg_pos_size
      FROM pm_wallet_pnl_summary
      ORDER BY pnl_net DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Top 10 Wallets by P&L:');
  console.table(samples);
  console.log('');

  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ pm_wallet_pnl_summary view created successfully');
  console.log('');
  console.log('Source: pm_wallet_market_pnl_resolved');
  console.log('Aggregation: Per wallet_address');
  console.log('');
  console.log(`Total Wallets: ${parseInt(stats[0].total_wallets).toLocaleString()}`);
  console.log(`Profitable: ${parseInt(stats[0].profitable_wallets).toLocaleString()} (${(parseInt(stats[0].profitable_wallets) / parseInt(stats[0].total_wallets) * 100).toFixed(2)}%)`);
  console.log(`Unprofitable: ${parseInt(stats[0].unprofitable_wallets).toLocaleString()} (${(parseInt(stats[0].unprofitable_wallets) / parseInt(stats[0].total_wallets) * 100).toFixed(2)}%)`);
  console.log(`Breakeven: ${parseInt(stats[0].breakeven_wallets).toLocaleString()}`);
  console.log('');
  console.log('Summary Metrics:');
  console.log(`  Total Net P&L: $${parseFloat(stats[0].total_pnl_net).toLocaleString()}`);
  console.log(`  Total Fees: $${parseFloat(stats[0].total_fees).toLocaleString()}`);
  console.log(`  Avg Markets per Wallet: ${parseFloat(stats[0].avg_markets_per_wallet)}`);
  console.log(`  Avg Win Rate: ${(parseFloat(stats[0].avg_win_rate) * 100).toFixed(2)}%`);
  console.log('');
}

main().catch((error) => {
  console.error('❌ View creation failed:', error);
  process.exit(1);
});
