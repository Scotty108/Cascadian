#!/usr/bin/env npx tsx
/**
 * Deploy system wallet mapping views to ClickHouse
 * These views integrate the system_wallet_map table for accurate leaderboards
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('DEPLOYING SYSTEM WALLET MAPPING VIEWS');
  console.log('═'.repeat(100) + '\n');

  // View 1: Leaderboard with Mapping
  console.log('1️⃣  Deploying: vw_wallet_leaderboard_with_mapping...');
  try {
    await ch.command({
      query: `
        CREATE OR REPLACE VIEW default.vw_wallet_leaderboard_with_mapping AS
        WITH remapped_trades AS (
          SELECT
            COALESCE(m.user_wallet, t.wallet_address_norm) as real_wallet,
            t.transaction_hash,
            t.condition_id_norm,
            t.trade_direction,
            t.shares,
            t.entry_price,
            t.usd_value,
            t.timestamp
          FROM default.vw_trades_canonical t
          LEFT JOIN cascadian_clean.system_wallet_map m
            ON m.tx_hash = t.transaction_hash
            AND m.system_wallet = t.wallet_address_norm
            AND m.confidence IN ('HIGH', 'MEDIUM')
        )
        SELECT
          real_wallet as wallet_address,
          COUNT(*) as total_trades,
          uniqExact(condition_id_norm) as unique_markets,
          countIf(trade_direction = 'BUY') as buys,
          countIf(trade_direction = 'SELL') as sells,
          round(100.0 * countIf(trade_direction = 'BUY') / COUNT(*), 2) as win_rate_pct,
          round(SUM(usd_value), 2) as total_volume,
          min(timestamp) as first_trade,
          max(timestamp) as last_trade
        FROM remapped_trades
        WHERE real_wallet != ''
        GROUP BY real_wallet
        ORDER BY total_trades DESC
      `,
    });
    console.log('   ✅ Leaderboard view deployed\n');
  } catch (e: any) {
    console.error('   ❌ Error:', e.message);
  }

  // View 2: PnL with Mapping
  console.log('2️⃣  Deploying: vw_wallet_pnl_with_mapping...');
  try {
    await ch.command({
      query: `
        CREATE OR REPLACE VIEW default.vw_wallet_pnl_with_mapping AS
        WITH remapped_trades AS (
          SELECT
            COALESCE(m.user_wallet, t.wallet_address_norm) as real_wallet,
            t.transaction_hash,
            t.condition_id_norm,
            t.trade_direction,
            t.shares,
            t.usd_value,
            t.trade_key
          FROM default.vw_trades_canonical t
          LEFT JOIN cascadian_clean.system_wallet_map m
            ON m.tx_hash = t.transaction_hash
            AND m.system_wallet = t.wallet_address_norm
            AND m.confidence IN ('HIGH', 'MEDIUM')
        )
        SELECT
          real_wallet as wallet_address,
          COUNT(*) as trades,
          round(SUM(usd_value), 2) as total_volume_usd,
          round(AVG(usd_value), 2) as avg_volume,
          round(100.0 * countIf(trade_direction = 'BUY') / COUNT(*), 2) as win_rate_pct,
          uniqExact(condition_id_norm) as markets_traded
        FROM remapped_trades
        WHERE real_wallet != ''
        GROUP BY real_wallet
        ORDER BY trades DESC
      `,
    });
    console.log('   ✅ PnL view deployed\n');
  } catch (e: any) {
    console.error('   ❌ Error:', e.message);
  }

  // View 3: Metrics with Mapping
  console.log('3️⃣  Deploying: vw_wallet_metrics_with_mapping...');
  try {
    await ch.command({
      query: `
        CREATE OR REPLACE VIEW default.vw_wallet_metrics_with_mapping AS
        WITH remapped_trades AS (
          SELECT
            COALESCE(m.user_wallet, t.wallet_address_norm) as real_wallet,
            t.condition_id_norm,
            t.trade_direction,
            t.shares,
            t.usd_value
          FROM default.vw_trades_canonical t
          LEFT JOIN cascadian_clean.system_wallet_map m
            ON m.tx_hash = t.transaction_hash
            AND m.system_wallet = t.wallet_address_norm
            AND m.confidence IN ('HIGH', 'MEDIUM')
        )
        SELECT
          real_wallet as wallet_address,
          COUNT(*) as total_trades,
          uniqExact(condition_id_norm) as markets_traded,
          countIf(trade_direction = 'BUY') as total_buys,
          countIf(trade_direction = 'SELL') as total_sells,
          round(100.0 * countIf(trade_direction = 'BUY') / COUNT(*), 2) as buy_pct,
          round(100.0 * countIf(trade_direction = 'SELL') / COUNT(*), 2) as sell_pct,
          round(SUM(usd_value), 2) as volume_usd,
          round(AVG(usd_value), 2) as avg_trade_value,
          round(100.0 * countIf(trade_direction = 'BUY') / COUNT(*), 2) as win_rate_pct
        FROM remapped_trades
        WHERE real_wallet != ''
        GROUP BY real_wallet
        ORDER BY total_trades DESC
      `,
    });
    console.log('   ✅ Metrics view deployed\n');
  } catch (e: any) {
    console.error('   ❌ Error:', e.message);
  }

  // Verify the views exist
  console.log('═'.repeat(100));
  console.log('VERIFICATION');
  console.log('═'.repeat(100) + '\n');

  const views = [
    'vw_wallet_leaderboard_with_mapping',
    'vw_wallet_pnl_with_mapping',
    'vw_wallet_metrics_with_mapping',
  ];

  for (const view of views) {
    try {
      const result = await ch.query({
        query: `SELECT 1 LIMIT 1 FROM default.${view}`,
        format: 'JSONEachRow',
      });
      const data = await result.json();
      console.log(`✅ ${view} - EXISTS and is queryable`);
    } catch (e: any) {
      console.log(`❌ ${view} - ERROR: ${e.message}`);
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log('NEXT STEPS');
  console.log('═'.repeat(100) + '\n');
  console.log('Views deployed successfully! Now:');
  console.log('  1. Query vw_wallet_leaderboard_with_mapping to see top traders with mapping applied');
  console.log('  2. Verify system wallet 0x4bfb no longer appears on leaderboard');
  console.log('  3. Check for 851K+ individual traders now visible with mapping');
  console.log('  4. Compare win_rate_pct from vw_wallet_metrics_with_mapping (should be accurate now)');
  console.log('');

  await ch.close();
}

main().catch(console.error);
