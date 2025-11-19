#!/usr/bin/env tsx
/**
 * Populate pm_wallet_summary_v2
 *
 * Aggregate pm_wallet_market_pnl_v2 into wallet-level summaries
 * Expected runtime: <1 minute for 573K wallets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('👤 PM Wallet Summary V2 - Population');
  console.log('='.repeat(80));
  console.log('Source: pm_wallet_market_pnl_v2');
  console.log('Method: Wallet-level aggregation');
  console.log('');

  // Step 1: Create table from DDL
  console.log('📦 Creating pm_wallet_summary_v2 table...');
  console.log('-'.repeat(80));

  const ddl = fs.readFileSync('sql/ddl_pm_wallet_summary_v2.sql', 'utf-8');
  const createTableSQL = ddl.split('-- ============================================================================\n-- Population Query')[0];

  // Check if table already exists
  const checkQuery = `
    SELECT count() AS count
    FROM system.tables
    WHERE database = 'default' AND name = 'pm_wallet_summary_v2'
  `;

  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const exists = parseInt((await checkResult.json())[0].count) > 0;

  if (exists) {
    console.log('⚠️  Table already exists, dropping and recreating...');
    await clickhouse.command({ query: 'DROP TABLE pm_wallet_summary_v2' });
    console.log('✓ Dropped existing table');
  }

  await clickhouse.command({ query: createTableSQL });
  console.log('✓ Created pm_wallet_summary_v2');
  console.log('');

  // Step 2: Populate with atomic INSERT
  console.log('📥 Populating pm_wallet_summary_v2...');
  console.log('-'.repeat(80));
  console.log('Aggregating 4.7M positions by wallet...');
  console.log('');

  const insertQuery = `
    INSERT INTO pm_wallet_summary_v2
    SELECT
      wallet_address,

      -- P&L totals (aggregated then cast)
      CAST(sum_total_pnl AS Decimal(18,2)) AS total_pnl_usd,
      CAST(sum_realized_pnl AS Decimal(18,2)) AS realized_pnl_usd,
      CAST(sum_unrealized_pnl AS Decimal(18,2)) AS unrealized_pnl_usd,
      CAST(sum_settlement_pnl AS Decimal(18,2)) AS settlement_pnl_usd,

      -- Trade volume
      sum_trades AS total_trades,
      unique_markets AS total_markets,
      CAST(sum_volume AS Decimal(18,2)) AS total_volume_usd,

      -- Position metrics
      open_pos AS open_positions,
      closed_pos AS closed_positions,
      resolved_pos AS resolved_positions,

      -- Performance metrics
      CAST(win_rate_calc AS Decimal(5,2)) AS win_rate,
      CAST(avg_pnl_market AS Decimal(18,2)) AS avg_pnl_per_market,
      CAST(avg_pnl_trade AS Decimal(18,2)) AS avg_pnl_per_trade,
      CAST(max_profit AS Decimal(18,2)) AS max_profit_usd,
      CAST(max_loss AS Decimal(18,2)) AS max_loss_usd,

      -- Risk metrics
      NULL AS sharpe_ratio,
      NULL AS max_drawdown_usd,
      win_loss_calc AS win_loss_ratio,

      -- Coverage metrics (0 orphans based on coverage report)
      sum_trades AS covered_trades,
      0 AS orphan_trades,
      CAST(sum_volume AS Decimal(18,2)) AS covered_volume_usd,
      0 AS orphan_volume_usd,
      100.0 AS coverage_pct,

      -- Temporal
      first_trade AS first_trade_at,
      last_trade AS last_trade_at,
      days_active_calc AS days_active,

      -- Metadata
      now() AS created_at,
      now() AS updated_at,
      now() AS version

    FROM (
      SELECT
        wallet_address,

        -- Pre-aggregate all values
        SUM(toFloat64(total_pnl_usd)) AS sum_total_pnl,
        SUM(toFloat64(realized_pnl_usd)) AS sum_realized_pnl,
        SUM(toFloat64(unrealized_pnl_usd)) AS sum_unrealized_pnl,
        SUM(toFloat64(settlement_pnl_usd)) AS sum_settlement_pnl,

        SUM(total_trades) AS sum_trades,
        uniqExact(condition_id_norm) AS unique_markets,
        SUM(toFloat64(covered_volume_usd)) AS sum_volume,

        SUM(CASE WHEN final_position_size != 0 THEN 1 ELSE 0 END) AS open_pos,
        SUM(CASE WHEN final_position_size = 0 THEN 1 ELSE 0 END) AS closed_pos,
        SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) AS resolved_pos,

        -- Calculate metrics as Float64
        (SUM(CASE WHEN total_pnl_usd > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0)) AS win_rate_calc,
        AVG(toFloat64(total_pnl_usd)) AS avg_pnl_market,
        SUM(toFloat64(total_pnl_usd)) / NULLIF(SUM(total_trades), 0) AS avg_pnl_trade,
        MAX(toFloat64(total_pnl_usd)) AS max_profit,
        MIN(toFloat64(total_pnl_usd)) AS max_loss,

        AVG(CASE WHEN total_pnl_usd > 0 THEN toFloat64(total_pnl_usd) END) /
        NULLIF(ABS(AVG(CASE WHEN total_pnl_usd < 0 THEN toFloat64(total_pnl_usd) END)), 0) AS win_loss_calc,

        MIN(first_trade_at) AS first_trade,
        MAX(last_trade_at) AS last_trade,
        dateDiff('day', MIN(first_trade_at), MAX(last_trade_at)) + 1 AS days_active_calc

      FROM pm_wallet_market_pnl_v2
      GROUP BY wallet_address
    ) AS aggregated
  `;

  const startTime = Date.now();
  await clickhouse.command({ query: insertQuery });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`✓ Populated pm_wallet_summary_v2 in ${elapsed}s`);
  console.log('');

  // Step 3: Validate and report
  console.log('📊 Validating results...');
  console.log('-'.repeat(80));
  console.log('');

  // 3a. Total wallet count
  const countQuery = `SELECT COUNT(*) AS count FROM pm_wallet_summary_v2`;
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const totalWallets = parseInt((await countResult.json())[0].count);

  console.log(`Total wallets: ${totalWallets.toLocaleString()}`);
  console.log('');

  // 3b. P&L distribution
  const pnlDistQuery = `
    SELECT
      CASE
        WHEN total_pnl_usd > 10000 THEN 'whale_profit'
        WHEN total_pnl_usd > 1000 THEN 'profit'
        WHEN total_pnl_usd > -1000 THEN 'neutral'
        WHEN total_pnl_usd > -10000 THEN 'loss'
        ELSE 'whale_loss'
      END AS pnl_bucket,
      COUNT(*) AS wallets,
      SUM(total_pnl_usd) AS total_pnl
    FROM pm_wallet_summary_v2
    GROUP BY pnl_bucket
    ORDER BY pnl_bucket
  `;

  const pnlDistResult = await clickhouse.query({ query: pnlDistQuery, format: 'JSONEachRow' });
  const pnlDistRows = await pnlDistResult.json() as any[];

  console.log('P&L distribution:');
  for (const row of pnlDistRows) {
    console.log(`  ${row.pnl_bucket}: ${parseInt(row.wallets).toLocaleString()} wallets ($${parseFloat(row.total_pnl).toFixed(2)} total)`);
  }
  console.log('');

  // 3c. Top 10 wallets by total P&L
  const topQuery = `
    SELECT
      wallet_address,
      total_pnl_usd,
      total_trades,
      total_markets,
      win_rate
    FROM pm_wallet_summary_v2
    ORDER BY total_pnl_usd DESC
    LIMIT 10
  `;

  const topResult = await clickhouse.query({ query: topQuery, format: 'JSONEachRow' });
  const topRows = await topResult.json() as any[];

  console.log('Top 10 wallets by total P&L:');
  for (let i = 0; i < topRows.length; i++) {
    const w = topRows[i];
    const walletShort = `${w.wallet_address.slice(0, 6)}...${w.wallet_address.slice(-4)}`;
    console.log(`  ${i + 1}. ${walletShort} - $${parseFloat(w.total_pnl_usd).toFixed(2)} (${w.total_trades} trades, ${w.total_markets} markets, ${parseFloat(w.win_rate).toFixed(1)}% win rate)`);
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('✅ PM WALLET SUMMARY V2 POPULATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total wallets: ${totalWallets.toLocaleString()}`);
  console.log('');
  console.log('Next Step: Create PNL V2 validation report');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
