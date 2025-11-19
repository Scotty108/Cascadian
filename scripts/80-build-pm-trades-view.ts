#!/usr/bin/env tsx
/**
 * Build pm_trades View - Canonical Trades
 *
 * Creates canonical trades view from clob_fills joined with pm_asset_token_map.
 * Follows PM_CANONICAL_SCHEMA_C1.md specification.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Building pm_trades View (Canonical Trades)');
  console.log('='.repeat(60));
  console.log('');

  console.log('Source Tables:');
  console.log('  - Base: clob_fills (38.9M rows)');
  console.log('  - Mapping: pm_asset_token_map (139K assets)');
  console.log('');

  console.log('Step 1: Dropping existing pm_trades view if exists...');
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_trades'
  });
  console.log('✅ Old view dropped');
  console.log('');

  console.log('Step 2: Creating pm_trades view...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE VIEW pm_trades AS
      SELECT
        -- Event Identification
        cf.fill_id,                                             -- String, unique CLOB fill ID
        cf.timestamp as block_time,                             -- DateTime, trade timestamp
        0 as block_number,                                      -- UInt64, not available in clob_fills
        cf.tx_hash,                                             -- String, transaction hash

        -- Asset & Market (CLOB IDs)
        cf.asset_id as asset_id_decimal,                        -- String, CLOB asset ID (76-78 chars)

        -- Canonical Anchors (from pm_asset_token_map)
        atm.condition_id as condition_id,                       -- String, normalized condition ID
        atm.outcome_index as outcome_index,                     -- UInt8, 0-based outcome index
        atm.outcome_label as outcome_label,                     -- String, "Yes", "No", etc.
        atm.question as question,                               -- String, market question

        -- Wallet Information
        lower(cf.proxy_wallet) as wallet_address,               -- String, proxy wallet (canonical)
        lower(cf.user_eoa) as operator_address,                 -- String, EOA operator
        CASE
          WHEN lower(cf.proxy_wallet) != lower(cf.user_eoa) THEN 1
          ELSE 0
        END as is_proxy_trade,                                  -- UInt8, 1 if proxy != EOA

        -- Trade Details
        cf.side,                                                -- String, 'BUY' or 'SELL'
        cf.price,                                               -- Float64, price per share (0-1)
        cf.size / 1000000.0 as shares,                          -- Float64, shares (size in micro-units, divide by 10^6)
        (cf.size / 1000000.0) * cf.price as collateral_amount, -- Float64, USDC notional
        (cf.size / 1000000.0) * cf.price * (cf.fee_rate_bps / 10000.0) as fee_amount,  -- Float64, fee in USDC

        -- Source Tracking
        'clob_fills' as data_source                             -- String, source table

      FROM clob_fills cf
      INNER JOIN pm_asset_token_map atm
        ON cf.asset_id = atm.asset_id_decimal
      WHERE cf.fill_id IS NOT NULL
        AND cf.asset_id IS NOT NULL
    `
  });

  console.log('✅ pm_trades view created');
  console.log('');

  // Get quick stats
  console.log('Step 3: Gathering statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT asset_id_decimal) as distinct_assets,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        COUNT(DISTINCT wallet_address) as distinct_wallets,
        COUNT(CASE WHEN is_proxy_trade = 1 THEN 1 END) as proxy_trades,
        MIN(block_time) as earliest_trade,
        MAX(block_time) as latest_trade
      FROM pm_trades
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('pm_trades Statistics:');
  console.table(stats);
  console.log('');

  // Sample trades
  console.log('Step 4: Sample trades...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(fill_id, 1, 20) || '...' as fill_id_short,
        block_time,
        substring(asset_id_decimal, 1, 20) || '...' as asset_short,
        substring(condition_id, 1, 16) || '...' as condition_short,
        outcome_index,
        outcome_label,
        substring(wallet_address, 1, 10) || '...' as wallet_short,
        is_proxy_trade,
        side,
        price,
        shares,
        collateral_amount,
        data_source
      FROM pm_trades
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Sample Trades:');
  console.table(samples);
  console.log('');

  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ pm_trades view created successfully');
  console.log('');
  console.log('Base Table: clob_fills');
  console.log('Join: INNER JOIN on asset_id = asset_id_decimal');
  console.log('');
  console.log(`Total Trades: ${parseInt(stats[0].total_trades).toLocaleString()}`);
  console.log(`Distinct Conditions: ${parseInt(stats[0].distinct_conditions).toLocaleString()}`);
  console.log(`Distinct Wallets: ${parseInt(stats[0].distinct_wallets).toLocaleString()}`);
  console.log(`Proxy Trades: ${parseInt(stats[0].proxy_trades).toLocaleString()} (${(parseInt(stats[0].proxy_trades) / parseInt(stats[0].total_trades) * 100).toFixed(2)}%)`);
  console.log('');
  console.log('Date Range:');
  console.log(`  Earliest: ${stats[0].earliest_trade}`);
  console.log(`  Latest: ${stats[0].latest_trade}`);
  console.log('');
  console.log('Schema Compliance:');
  console.log('  ✅ CLOB-first (uses asset_id_decimal from clob_fills)');
  console.log('  ✅ Proxy-aware (tracks proxy vs EOA)');
  console.log('  ✅ Streaming-friendly (no hard-coded time filters)');
  console.log('  ✅ Non-destructive (view, not table)');
  console.log('');
  console.log('Note: block_number set to 0 (not available in clob_fills)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ View creation failed:', error);
  process.exit(1);
});
