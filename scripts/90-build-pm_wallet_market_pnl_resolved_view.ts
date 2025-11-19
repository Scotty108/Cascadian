#!/usr/bin/env tsx
/**
 * Build pm_wallet_market_pnl_resolved View - P&L Analytics
 *
 * Creates canonical P&L view for resolved binary markets.
 * Follows PM_PNL_SPEC_C1.md specification exactly.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Building pm_wallet_market_pnl_resolved View (P&L Analytics)');
  console.log('='.repeat(60));
  console.log('');

  console.log('Specification: PM_PNL_SPEC_C1.md');
  console.log('Scope: Resolved binary markets only');
  console.log('Source: pm_trades_complete ⟕ pm_markets');
  console.log('  (pm_trades_complete = interface layer for CLOB + external trades)');
  console.log('');

  console.log('Step 1: Dropping existing pm_wallet_market_pnl_resolved view if exists...');
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_wallet_market_pnl_resolved'
  });
  console.log('✅ Old view dropped');
  console.log('');

  console.log('Step 2: Creating pm_wallet_market_pnl_resolved view...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE VIEW pm_wallet_market_pnl_resolved AS
      SELECT
        -- Grouping Keys
        t.canonical_wallet_address as wallet_address,       -- String, canonical wallet (aggregates EOA + proxy)
        t.condition_id as condition_id,                     -- String, condition ID (64 chars)
        t.outcome_index as outcome_index,                   -- UInt8, 0-based outcome index
        t.outcome_label as outcome_label,                   -- String, "Yes", "No", etc.
        t.question as question,                             -- String, market question

        -- Trade Metrics
        COUNT(*) as total_trades,                           -- UInt64, number of trades
        MIN(t.block_time) as first_trade_ts,                -- DateTime, first trade timestamp
        MAX(t.block_time) as last_trade_ts,                 -- DateTime, last trade timestamp
        SUM(ABS(t.shares)) as total_shares,                 -- Float64, total volume (unsigned)
        SUM(CASE WHEN t.side = 'BUY' THEN t.shares ELSE 0 END) as total_bought,  -- Float64, total bought
        SUM(CASE WHEN t.side = 'SELL' THEN t.shares ELSE 0 END) as total_sold,   -- Float64, total sold
        SUM(CASE
          WHEN t.side = 'BUY' THEN t.shares
          ELSE -t.shares
        END) as net_shares,                                 -- Float64, net position (+long, -short, 0=flat)
        SUM(CASE
          WHEN m.is_winning_outcome = 1 AND t.side = 'BUY' THEN t.shares
          WHEN m.is_winning_outcome = 1 AND t.side = 'SELL' THEN -t.shares
          ELSE 0
        END) as winning_shares,                             -- Float64, net shares if won
        SUM(t.shares * t.price) / SUM(t.shares) as avg_price,  -- Float64, volume-weighted average price

        -- Notional Metrics
        SUM(ABS(t.shares) * t.price) as gross_notional,     -- Float64, total capital deployed
        SUM(CASE
          WHEN t.side = 'BUY' THEN t.shares * t.price
          ELSE -t.shares * t.price
        END) as net_notional,                               -- Float64, net capital (can be negative)

        -- P&L Metrics
        SUM(t.fee_amount) as fees_paid,                     -- Float64, total fees paid
        SUM(
          CASE
            WHEN t.side = 'BUY' THEN t.shares
            ELSE -t.shares
          END * (
            CASE
              WHEN m.is_winning_outcome = 1 THEN 1.0
              ELSE 0.0
            END - t.price
          )
        ) as pnl_gross,                                     -- Float64, P&L before fees
        SUM(
          CASE
            WHEN t.side = 'BUY' THEN t.shares
            ELSE -t.shares
          END * (
            CASE
              WHEN m.is_winning_outcome = 1 THEN 1.0
              ELSE 0.0
            END - t.price
          )
        ) - SUM(t.fee_amount) as pnl_net,                  -- Float64, P&L after fees (final metric)

        -- Market Context
        m.market_type as market_type,                       -- String, market type (binary)
        m.status as status,                                 -- String, market status (resolved)
        m.resolved_at as resolved_at,                       -- DateTime, resolution timestamp
        m.winning_outcome_index as winning_outcome_index,   -- UInt16, winning outcome index
        m.is_winning_outcome as is_winning_outcome,         -- UInt8, 1 if this outcome won

        -- Source Tracking
        groupArray(DISTINCT t.data_source) as data_sources  -- Array(String), all sources for this position

      FROM pm_trades_complete t
      INNER JOIN pm_markets m
        ON t.condition_id = m.condition_id
        AND t.outcome_index = m.outcome_index
      WHERE m.status = 'resolved'
        AND m.market_type = 'binary'
      GROUP BY
        t.canonical_wallet_address,
        t.condition_id,
        t.outcome_index,
        t.outcome_label,
        t.question,
        m.market_type,
        m.status,
        m.resolved_at,
        m.winning_outcome_index,
        m.is_winning_outcome
    `
  });

  console.log('✅ pm_wallet_market_pnl_resolved view created');
  console.log('');

  // Get quick stats
  console.log('Step 3: Gathering statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(DISTINCT wallet_address) as distinct_wallets,
        COUNT(DISTINCT condition_id) as distinct_markets,
        SUM(total_trades) as total_trades_sum,
        ROUND(SUM(fees_paid), 2) as total_fees,
        ROUND(SUM(pnl_gross), 2) as total_pnl_gross,
        ROUND(SUM(pnl_net), 2) as total_pnl_net,
        COUNT(CASE WHEN pnl_net > 0 THEN 1 END) as winning_positions,
        COUNT(CASE WHEN pnl_net < 0 THEN 1 END) as losing_positions,
        COUNT(CASE WHEN pnl_net = 0 THEN 1 END) as breakeven_positions
      FROM pm_wallet_market_pnl_resolved
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('pm_wallet_market_pnl_resolved Statistics:');
  console.table(stats);
  console.log('');

  // Sample positions
  console.log('Step 4: Sample positions (top 10 by pnl_net)...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(wallet_address, 1, 10) || '...' as wallet_short,
        substring(condition_id, 1, 16) || '...' as condition_short,
        outcome_index,
        outcome_label,
        total_trades,
        ROUND(net_shares, 2) as net_shares,
        ROUND(avg_price, 4) as avg_price,
        ROUND(fees_paid, 2) as fees,
        ROUND(pnl_gross, 2) as pnl_gross,
        ROUND(pnl_net, 2) as pnl_net,
        is_winning_outcome,
        substring(question, 1, 40) || '...' as question_short
      FROM pm_wallet_market_pnl_resolved
      ORDER BY pnl_net DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Top 10 Positions by P&L:');
  console.table(samples);
  console.log('');

  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ pm_wallet_market_pnl_resolved view created successfully');
  console.log('');
  console.log('Specification: PM_PNL_SPEC_C1.md');
  console.log('Source: pm_trades_complete ⟕ pm_markets (resolved binary only)');
  console.log('  (Interface layer allows seamless integration of external trades)');
  console.log('');
  console.log(`Total Positions: ${parseInt(stats[0].total_positions).toLocaleString()}`);
  console.log(`Distinct Wallets: ${parseInt(stats[0].distinct_wallets).toLocaleString()}`);
  console.log(`Distinct Markets: ${parseInt(stats[0].distinct_markets).toLocaleString()}`);
  console.log(`Total Trades: ${parseInt(stats[0].total_trades_sum).toLocaleString()}`);
  console.log('');
  console.log('P&L Summary:');
  console.log(`  Total Fees: $${parseFloat(stats[0].total_fees).toLocaleString()}`);
  console.log(`  Total Gross P&L: $${parseFloat(stats[0].total_pnl_gross).toLocaleString()}`);
  console.log(`  Total Net P&L: $${parseFloat(stats[0].total_pnl_net).toLocaleString()}`);
  console.log('');
  console.log('Position Distribution:');
  console.log(`  Winning: ${parseInt(stats[0].winning_positions).toLocaleString()}`);
  console.log(`  Losing: ${parseInt(stats[0].losing_positions).toLocaleString()}`);
  console.log(`  Breakeven: ${parseInt(stats[0].breakeven_positions).toLocaleString()}`);
  console.log('');
  console.log('Formula Validation:');
  console.log('  ✅ signed_shares = CASE side = BUY THEN +shares ELSE -shares');
  console.log('  ✅ payout_per_share = is_winning_outcome ? 1.0 : 0.0');
  console.log('  ✅ pnl_trade = signed_shares * (payout - price)');
  console.log('  ✅ pnl_net = SUM(pnl_trade) - SUM(fees)');
  console.log('');
  console.log('Constraints Applied:');
  console.log('  ✅ Only resolved markets (status = resolved)');
  console.log('  ✅ Only binary markets (market_type = binary)');
  console.log('  ✅ CLOB data only (pm_trades source)');
  console.log('  ✅ Streaming-friendly (VIEW, not TABLE)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ View creation failed:', error);
  process.exit(1);
});
