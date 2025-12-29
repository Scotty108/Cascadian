#!/usr/bin/env tsx
/**
 * Build pm_market_pnl_summary View - Market-Level P&L Summary
 *
 * Aggregates pm_wallet_market_pnl_resolved to market level (condition_id).
 * Provides total P&L, wallet participation, and volume metrics per market.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Building pm_market_pnl_summary View');
  console.log('='.repeat(60));
  console.log('');

  console.log('Sources: pm_wallet_market_pnl_resolved + pm_markets');
  console.log('Aggregation: Per condition_id');
  console.log('');

  console.log('Step 1: Dropping existing pm_market_pnl_summary view if exists...');
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_market_pnl_summary'
  });
  console.log('✅ Old view dropped');
  console.log('');

  console.log('Step 2: Creating pm_market_pnl_summary view...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE VIEW pm_market_pnl_summary AS
      WITH market_aggregates AS (
        SELECT
          w.condition_id,
          COUNT(DISTINCT w.wallet_address) as total_wallets,
          SUM(w.total_trades) as total_trades,
          SUM(w.gross_notional) as gross_notional,
          SUM(w.pnl_net) as pnl_net_total,
          SUM(CASE WHEN w.pnl_net > 0 THEN w.pnl_net ELSE 0 END) as total_positive_pnl,
          SUM(CASE WHEN w.pnl_net < 0 THEN w.pnl_net ELSE 0 END) as total_negative_pnl
        FROM pm_wallet_market_pnl_resolved w
        GROUP BY w.condition_id
      )
      SELECT
        a.condition_id,
        argMin(m.question, m.outcome_index) as question,
        argMin(m.status, m.outcome_index) as status,
        argMin(m.resolved_at, m.outcome_index) as resolved_at,
        argMin(m.winning_outcome_index, m.outcome_index) as winning_outcome_index,
        a.total_wallets,
        a.total_trades,
        a.gross_notional,
        a.pnl_net_total,
        a.total_positive_pnl,
        a.total_negative_pnl
      FROM market_aggregates a
      LEFT JOIN pm_markets m
        ON a.condition_id = m.condition_id
      WHERE m.status = 'resolved'
        AND m.market_type = 'binary'
      GROUP BY a.condition_id, a.total_wallets, a.total_trades, a.gross_notional, a.pnl_net_total, a.total_positive_pnl, a.total_negative_pnl
    `
  });

  console.log('✅ pm_market_pnl_summary view created');
  console.log('');

  // Get quick stats
  console.log('Step 3: Gathering statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_markets,
        ROUND(SUM(total_wallets), 0) as total_wallet_participations,
        ROUND(SUM(total_trades), 0) as total_trades,
        ROUND(SUM(gross_notional), 2) as total_gross_notional,
        ROUND(SUM(pnl_net_total), 2) as total_pnl_net,
        ROUND(SUM(total_positive_pnl), 2) as total_positive_pnl,
        ROUND(SUM(total_negative_pnl), 2) as total_negative_pnl,
        ROUND(AVG(total_wallets), 2) as avg_wallets_per_market
      FROM pm_market_pnl_summary
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('pm_market_pnl_summary Statistics:');
  console.table(stats);
  console.log('');

  // Sample markets
  console.log('Step 4: Sample markets (top 10 by total wallets)...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id, 1, 16) || '...' as condition_short,
        substring(question, 1, 50) || '...' as question_short,
        total_wallets,
        total_trades,
        ROUND(gross_notional, 2) as gross_notional,
        ROUND(pnl_net_total, 2) as pnl_net_total,
        ROUND(total_positive_pnl, 2) as pos_pnl,
        ROUND(total_negative_pnl, 2) as neg_pnl
      FROM pm_market_pnl_summary
      ORDER BY total_wallets DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Top 10 Markets by Wallet Participation:');
  console.table(samples);
  console.log('');

  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ pm_market_pnl_summary view created successfully');
  console.log('');
  console.log('Sources: pm_wallet_market_pnl_resolved + pm_markets');
  console.log('Aggregation: Per condition_id');
  console.log('');
  console.log(`Total Markets: ${parseInt(stats[0].total_markets).toLocaleString()}`);
  console.log(`Total Wallet Participations: ${parseFloat(stats[0].total_wallet_participations).toLocaleString()}`);
  console.log(`Total Trades: ${parseFloat(stats[0].total_trades).toLocaleString()}`);
  console.log(`Total Gross Notional: $${parseFloat(stats[0].total_gross_notional).toLocaleString()}`);
  console.log('');
  console.log('P&L Metrics:');
  console.log(`  Total Net P&L: $${parseFloat(stats[0].total_pnl_net).toLocaleString()}`);
  console.log(`  Total Positive P&L: $${parseFloat(stats[0].total_positive_pnl).toLocaleString()}`);
  console.log(`  Total Negative P&L: $${parseFloat(stats[0].total_negative_pnl).toLocaleString()}`);
  console.log(`  Avg Wallets per Market: ${parseFloat(stats[0].avg_wallets_per_market)}`);
  console.log('');
}

main().catch((error) => {
  console.error('❌ View creation failed:', error);
  process.exit(1);
});
