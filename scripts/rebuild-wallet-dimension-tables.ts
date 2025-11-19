#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

/**
 * REBUILD WALLET DIMENSION TABLES WITH CLEAN DATA
 *
 * Rebuilds wallets_dim and wallet_metrics from clean sources:
 * - vw_trades_canonical (clean trade data)
 * - wallet_pnl_summary_final (clean PnL data)
 * - condition_market_map (for category mapping)
 */

async function rebuildWalletDimensions() {
  console.log('REBUILDING WALLET DIMENSION TABLES WITH CLEAN DATA\n');
  console.log('═'.repeat(80));
  console.log('Building from clean sources:');
  console.log('  - vw_trades_canonical (trades)');
  console.log('  - wallet_pnl_summary_final (PnL)');
  console.log('  - vw_conditions_enriched (categories)\n');

  // 1. Rebuild wallets_dim
  console.log('1. Rebuilding wallets_dim...');
  console.log('─'.repeat(80));

  await client.exec({
    query: `
      CREATE OR REPLACE TABLE default.wallets_dim (
        wallet_address String,
        first_seen DateTime,
        last_seen DateTime,
        total_volume_usd Decimal(18, 2),
        total_trades UInt32,
        unique_markets UInt32,
        unique_categories UInt32,
        is_active Bool,
        created_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY wallet_address
    `,
  });

  console.log('  ✓ Created wallets_dim table structure');

  // Insert clean data
  await client.exec({
    query: `
      INSERT INTO default.wallets_dim
      SELECT
        wallet_address_norm,
        min(timestamp) AS first_seen,
        max(timestamp) AS last_seen,
        CAST(sum(abs(usd_value)) AS Decimal(18, 2)) AS total_volume_usd,
        CAST(count() AS UInt32) AS total_trades,
        CAST(count(DISTINCT market_id_norm) AS UInt32) AS unique_markets,
        CAST(count(DISTINCT category) AS UInt32) AS unique_categories,
        1 AS is_active,
        now() AS created_at,
        now() AS updated_at
      FROM (
        SELECT
          t.wallet_address_norm,
          t.timestamp,
          t.market_id_norm,
          t.usd_value,
          c.category_final AS category
        FROM default.vw_trades_canonical t
        LEFT JOIN default.vw_conditions_enriched c
          ON lower(t.condition_id_norm) = lower(c.condition_id)
        WHERE t.wallet_address_norm != ''
          AND t.wallet_address_norm != '0x0000000000000000000000000000000000000000'
          AND t.wallet_address_norm != '0x00000000000050ba7c429821e6d66429452ba168'  -- Exclude bad wallet
      )
      GROUP BY wallet_address_norm
    `,
  });

  const walletsCount = await client.query({
    query: 'SELECT count() as cnt FROM default.wallets_dim',
    format: 'JSONEachRow',
  });
  const wCount = (await walletsCount.json<any[]>())[0];
  console.log(`  ✓ Inserted ${wCount.cnt.toLocaleString()} wallets with clean data\n`);

  // 2. Rebuild wallet_metrics
  console.log('2. Rebuilding wallet_metrics...');
  console.log('─'.repeat(80));

  await client.exec({
    query: `
      CREATE OR REPLACE TABLE default.wallet_metrics (
        wallet_address String,
        total_trades UInt32,
        total_volume Decimal(18, 2),
        unique_markets UInt32,
        unique_categories UInt32,
        first_trade_date DateTime,
        last_trade_date DateTime,
        active_days UInt32,
        avg_trade_size Decimal(18, 2),
        max_trade_size Decimal(18, 2),
        avg_trades_per_day Float32,
        total_realized_pnl Decimal(18, 2),
        total_unrealized_pnl Decimal(18, 2),
        total_pnl Decimal(18, 2),
        favorite_category String,
        calculated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(calculated_at)
      ORDER BY wallet_address
    `,
  });

  console.log('  ✓ Created wallet_metrics table structure');

  // Insert clean data with PnL
  await client.exec({
    query: `
      INSERT INTO default.wallet_metrics
      SELECT
        t.wallet_address_norm AS wallet_address,
        CAST(count() AS UInt32) AS total_trades,
        CAST(sum(abs(t.usd_value)) AS Decimal(18, 2)) AS total_volume,
        CAST(count(DISTINCT t.market_id_norm) AS UInt32) AS unique_markets,
        CAST(count(DISTINCT c.category_final) AS UInt32) AS unique_categories,
        min(t.timestamp) AS first_trade_date,
        max(t.timestamp) AS last_trade_date,
        CAST(count(DISTINCT toDate(t.timestamp)) AS UInt32) AS active_days,
        CAST(avg(abs(t.usd_value)) AS Decimal(18, 2)) AS avg_trade_size,
        CAST(max(abs(t.usd_value)) AS Decimal(18, 2)) AS max_trade_size,
        CAST(count() / greatest(count(DISTINCT toDate(t.timestamp)), 1) AS Float32) AS avg_trades_per_day,
        CAST(coalesce(any(pnl.realized_pnl_usd), 0) AS Decimal(18, 2)) AS total_realized_pnl,
        CAST(coalesce(any(pnl.unrealized_pnl_usd), 0) AS Decimal(18, 2)) AS total_unrealized_pnl,
        CAST(coalesce(any(pnl.total_pnl_usd), 0) AS Decimal(18, 2)) AS total_pnl,
        any(c.category_final) AS favorite_category,
        now() AS calculated_at
      FROM default.vw_trades_canonical t
      LEFT JOIN default.vw_conditions_enriched c
        ON lower(t.condition_id_norm) = lower(c.condition_id)
      LEFT JOIN default.wallet_pnl_summary_final pnl
        ON t.wallet_address_norm = pnl.wallet
      WHERE t.wallet_address_norm != ''
        AND t.wallet_address_norm != '0x0000000000000000000000000000000000000000'
        AND t.wallet_address_norm != '0x00000000000050ba7c429821e6d66429452ba168'  -- Exclude bad wallet
      GROUP BY t.wallet_address_norm
    `,
  });

  const metricsCount = await client.query({
    query: 'SELECT count() as cnt FROM default.wallet_metrics',
    format: 'JSONEachRow',
  });
  const mCount = (await metricsCount.json<any[]>())[0];
  console.log(`  ✓ Inserted ${mCount.cnt.toLocaleString()} wallet metrics with clean data\n`);

  console.log('═'.repeat(80));
  console.log('REBUILD COMPLETE!\n');

  // Show sample data
  console.log('Sample from wallets_dim:');
  const walletsSample = await client.query({
    query: `
      SELECT
        wallet_address,
        first_seen,
        last_seen,
        total_volume_usd,
        total_trades,
        unique_markets
      FROM default.wallets_dim
      ORDER BY total_volume_usd DESC
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const wSamples = await walletsSample.json<any[]>();
  for (const row of wSamples) {
    console.log(`  ${row.wallet_address.slice(0, 20)}... - $${row.total_volume_usd} volume, ${row.total_trades} trades, ${row.unique_markets} markets`);
  }

  console.log('\nSample from wallet_metrics:');
  const metricsSample = await client.query({
    query: `
      SELECT
        wallet_address,
        total_trades,
        total_volume,
        total_pnl,
        favorite_category
      FROM default.wallet_metrics
      ORDER BY total_volume DESC
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const mSamples = await metricsSample.json<any[]>();
  for (const row of mSamples) {
    console.log(`  ${row.wallet_address.slice(0, 20)}... - $${row.total_volume} volume, $${row.total_pnl} PnL, ${row.total_trades} trades`);
  }

  console.log('\n✅ Both tables rebuilt with CLEAN data!');
  console.log('   - No problematic wallet addresses');
  console.log('   - Data sourced from vw_trades_canonical');
  console.log('   - PnL from wallet_pnl_summary_final');
  console.log('   - Categories from vw_conditions_enriched\n');

  await client.close();
}

rebuildWalletDimensions().catch(console.error);
