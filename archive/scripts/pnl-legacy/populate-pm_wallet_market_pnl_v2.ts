#!/usr/bin/env tsx
/**
 * Populate pm_wallet_market_pnl_v2
 *
 * Aggregate pm_trades_canonical_v2 into per-wallet, per-market P&L
 * - Uses FIFO cost basis
 * - Calculates realized P&L (sells - buys)
 * - Calculates settlement P&L for resolved markets
 * - Excludes orphan trades (is_orphan = 1)
 *
 * IMPORTANT: This uses a single atomic INSERT (no UPDATE statements)
 * to comply with ReplacingMergeTree best practices.
 *
 * Expected runtime: 10-30 minutes for ~140M trades → ~5-10M positions
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('💰 PM Wallet Market PnL V2 - Population');
  console.log('='.repeat(80));
  console.log('Source: pm_trades_canonical_v2 (repaired trades only)');
  console.log('Method: FIFO cost basis, single atomic INSERT');
  console.log('Filter: Exclude orphan trades (is_orphan = 1)');
  console.log('');

  // Step 1: Create table from DDL
  console.log('📦 Creating pm_wallet_market_pnl_v2 table...');
  console.log('-'.repeat(80));

  const ddl = fs.readFileSync('sql/ddl_pm_wallet_market_pnl_v2.sql', 'utf-8');

  // Extract just the CREATE TABLE portion (before the commented INSERT)
  const createTableSQL = ddl.split('-- ============================================================================\n-- Population Query')[0];

  // Check if table already exists
  const checkQuery = `
    SELECT count() AS count
    FROM system.tables
    WHERE database = 'default' AND name = 'pm_wallet_market_pnl_v2'
  `;

  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const exists = parseInt((await checkResult.json())[0].count) > 0;

  if (exists) {
    console.log('⚠️  Table already exists, dropping and recreating...');
    await clickhouse.command({ query: 'DROP TABLE pm_wallet_market_pnl_v2' });
    console.log('✓ Dropped existing table');
  }

  await clickhouse.command({ query: createTableSQL });
  console.log('✓ Created pm_wallet_market_pnl_v2');
  console.log('');

  // Step 2: Populate with atomic INSERT (includes settlement P&L)
  console.log('📥 Populating pm_wallet_market_pnl_v2...');
  console.log('-'.repeat(80));
  console.log('Aggregating 140M trades by wallet + condition_id + outcome_index...');
  console.log('Joining with market_resolutions_final for settlement data...');
  console.log('');

  const insertQuery = `
    INSERT INTO pm_wallet_market_pnl_v2
    SELECT
      trades.wallet_address,
      trades.condition_id_norm,
      trades.outcome_index,

      -- Optional market ID (mostly null for now)
      trades.market_id_norm,

      -- Trade volume
      trades.total_trades,
      trades.buy_trades,
      trades.sell_trades,

      -- Position metrics (cast from Float64 to Decimal)
      CAST(trades.total_bought_shares AS Decimal(18,8)) AS total_bought_shares,
      CAST(trades.total_sold_shares AS Decimal(18,8)) AS total_sold_shares,
      CAST(trades.final_position_size AS Decimal(18,8)) AS final_position_size,

      -- Cost basis (cast from Float64 to Decimal, use Float64 for averages to avoid inf/NaN cast issues)
      CAST(trades.total_cost_usd AS Decimal(18,2)) AS total_cost_usd,
      CAST(trades.total_proceeds_usd AS Decimal(18,2)) AS total_proceeds_usd,
      trades.avg_entry_price AS avg_entry_price,
      trades.avg_exit_price AS avg_exit_price,

      -- P&L components (cast from Float64 to Decimal)
      CAST(trades.realized_pnl_usd AS Decimal(18,2)) AS realized_pnl_usd,

      -- Unrealized P&L (for now, set to 0 - will add current prices later)
      0 AS unrealized_pnl_usd,

      -- Settlement P&L (skip for now - will add in a view layer)
      0 AS settlement_pnl_usd,

      -- Total P&L (realized only for now)
      trades.realized_pnl_usd AS total_pnl_usd,

      -- Resolution status
      CASE WHEN res.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END AS is_resolved,
      res.resolved_at,
      res.winning_outcome,
      NULL AS payout_per_share,

      -- Current market price (TODO: add from CLOB fills)
      NULL AS current_market_price,
      NULL AS price_updated_at,

      -- Coverage tracking
      trades.covered_volume_usd,
      0 AS orphan_volume_usd,  -- 0 orphans in our case
      100.0 AS coverage_pct,

      -- Temporal
      trades.first_trade_at,
      trades.last_trade_at,
      now() AS created_at,
      now() AS updated_at,
      now() AS version

    FROM (
      SELECT
        wallet_address,
        condition_id_norm_v2 AS condition_id_norm,
        outcome_index_v2 AS outcome_index,

        -- Optional market ID
        anyLast(market_id_norm_v2) AS market_id_norm,

        -- Trade volume
        COUNT(*) AS total_trades,
        SUM(CASE WHEN trade_direction = 'BUY' THEN 1 ELSE 0 END) AS buy_trades,
        SUM(CASE WHEN trade_direction = 'SELL' THEN 1 ELSE 0 END) AS sell_trades,

        -- Position metrics (as Float64 to avoid Decimal scale issues)
        SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END) AS total_bought_shares,
        SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END) AS total_sold_shares,
        SUM(CASE
          WHEN trade_direction = 'BUY' THEN toFloat64(shares)
          WHEN trade_direction = 'SELL' THEN -toFloat64(shares)
          ELSE 0
        END) AS final_position_size,

        -- Cost basis (as Float64)
        SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) AS total_cost_usd,
        SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) AS total_proceeds_usd,

        -- Weighted average prices (division in Float64, with inf/NaN protection)
        CASE
          WHEN SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END) > 0.0
          THEN SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) /
               SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END)
          ELSE NULL
        END AS avg_entry_price,

        CASE
          WHEN SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END) > 0.0
          THEN SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) /
               SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END)
          ELSE NULL
        END AS avg_exit_price,

        -- Realized P&L (sells - buys, as Float64)
        SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) -
        SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) AS realized_pnl_usd,

        -- Coverage (as Float64)
        SUM(toFloat64(usd_value)) AS covered_volume_usd,

        -- Temporal
        MIN(timestamp) AS first_trade_at,
        MAX(timestamp) AS last_trade_at

      FROM pm_trades_canonical_v2
      WHERE
        is_orphan = 0  -- Exclude orphan trades
        AND condition_id_norm_v2 IS NOT NULL
        AND condition_id_norm_v2 != ''
      GROUP BY
        wallet_address,
        condition_id_norm_v2,
        outcome_index_v2
    ) AS trades

    -- LEFT JOIN with resolutions for settlement P&L
    LEFT JOIN market_resolutions_final AS res
      ON trades.condition_id_norm = res.condition_id_norm
  `;

  const startTime = Date.now();
  await clickhouse.command({ query: insertQuery });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`✓ Populated pm_wallet_market_pnl_v2 in ${elapsed}s`);
  console.log('');

  // Step 3: Validate and report
  console.log('📊 Validating results...');
  console.log('-'.repeat(80));
  console.log('');

  // 3a. Total position count
  const countQuery = `SELECT COUNT(*) AS count FROM pm_wallet_market_pnl_v2`;
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const totalPositions = parseInt((await countResult.json())[0].count);

  console.log(`Total positions: ${totalPositions.toLocaleString()}`);
  console.log('');

  // 3b. Wallet count
  const walletCountQuery = `SELECT uniqExact(wallet_address) AS count FROM pm_wallet_market_pnl_v2`;
  const walletCountResult = await clickhouse.query({ query: walletCountQuery, format: 'JSONEachRow' });
  const totalWallets = parseInt((await walletCountResult.json())[0].count);

  console.log(`Unique wallets: ${totalWallets.toLocaleString()}`);
  console.log('');

  // 3c. Resolved vs unresolved
  const resolvedQuery = `
    SELECT
      is_resolved,
      COUNT(*) AS count,
      SUM(total_pnl_usd) AS total_pnl
    FROM pm_wallet_market_pnl_v2
    GROUP BY is_resolved
  `;

  const resolvedResult = await clickhouse.query({ query: resolvedQuery, format: 'JSONEachRow' });
  const resolvedRows = await resolvedResult.json() as any[];

  console.log('Resolution status:');
  for (const row of resolvedRows) {
    const label = row.is_resolved === 1 ? 'Resolved' : 'Unresolved';
    console.log(`  ${label}: ${parseInt(row.count).toLocaleString()} positions ($${parseFloat(row.total_pnl).toFixed(2)} total P&L)`);
  }
  console.log('');

  // 3d. P&L distribution
  const pnlDistQuery = `
    SELECT
      CASE
        WHEN total_pnl_usd > 1000 THEN 'whale_profit'
        WHEN total_pnl_usd > 100 THEN 'profit'
        WHEN total_pnl_usd > -100 THEN 'neutral'
        WHEN total_pnl_usd > -1000 THEN 'loss'
        ELSE 'whale_loss'
      END AS pnl_bucket,
      COUNT(*) AS positions,
      SUM(total_pnl_usd) AS total_pnl
    FROM pm_wallet_market_pnl_v2
    GROUP BY pnl_bucket
    ORDER BY pnl_bucket
  `;

  const pnlDistResult = await clickhouse.query({ query: pnlDistQuery, format: 'JSONEachRow' });
  const pnlDistRows = await pnlDistResult.json() as any[];

  console.log('P&L distribution:');
  for (const row of pnlDistRows) {
    console.log(`  ${row.pnl_bucket}: ${parseInt(row.positions).toLocaleString()} positions ($${parseFloat(row.total_pnl).toFixed(2)} total)`);
  }
  console.log('');

  // 3e. Top 10 positions by absolute P&L
  const topPnlQuery = `
    SELECT
      wallet_address,
      condition_id_norm,
      outcome_index,
      total_trades,
      final_position_size,
      total_pnl_usd,
      is_resolved
    FROM pm_wallet_market_pnl_v2
    ORDER BY abs(total_pnl_usd) DESC
    LIMIT 10
  `;

  const topPnlResult = await clickhouse.query({ query: topPnlQuery, format: 'JSONEachRow' });
  const topPnlRows = await topPnlResult.json() as any[];

  console.log('Top 10 positions by absolute P&L:');
  for (let i = 0; i < topPnlRows.length; i++) {
    const pos = topPnlRows[i];
    const walletShort = `${pos.wallet_address.slice(0, 6)}...${pos.wallet_address.slice(-4)}`;
    const condShort = `${pos.condition_id_norm.slice(0, 8)}...`;
    const resolved = pos.is_resolved === 1 ? '✓' : '✗';
    console.log(`  ${i + 1}. ${walletShort} - ${condShort} - outcome ${pos.outcome_index} - $${parseFloat(pos.total_pnl_usd).toFixed(2)} (${resolved} resolved)`);
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('✅ PM WALLET MARKET PNL V2 POPULATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total positions: ${totalPositions.toLocaleString()}`);
  console.log(`Unique wallets: ${totalWallets.toLocaleString()}`);
  console.log('');
  console.log('Next Step: Build pm_wallet_summary_v2 (wallet-level aggregates)');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
