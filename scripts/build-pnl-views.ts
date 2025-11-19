#!/usr/bin/env npx tsx

/**
 * Build P&L Views - Realized + Unrealized Profit & Loss
 *
 * Creates three canonical views:
 * 1. vw_realized_pnl - P&L from resolved markets (using payout vectors)
 * 2. vw_unrealized_pnl - P&L from open markets (using current prices)
 * 3. vw_total_pnl - Combined realized + unrealized P&L
 *
 * Sources:
 * - fact_trades - Canonical trade data
 * - dim_resolutions (market_resolutions_final) - Resolution data (157K markets, 67% coverage)
 * - market_candles_5m - Current prices for unrealized P&L
 *
 * Runtime: ~1-2 hours
 *
 * IMPORTANT: Run this AFTER fact_trades is built!
 */

import { createClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = createClickHouseClient();

  console.log('🏗️  Building P&L views...\n');

  // Step 0: Pre-flight checks
  console.log('Step 0: Pre-flight validation...');

  // Check fact_trades exists
  try {
    const factTradesCount = await ch.query({
      query: 'SELECT count() as count FROM default.fact_trades',
      format: 'JSONEachRow'
    });
    const rows = await factTradesCount.json<Array<{ count: string }>>();
    const rowCount = parseInt(rows[0].count);
    console.log(`  fact_trades: ${rowCount.toLocaleString()} trades ✅`);

    if (rowCount < 100_000_000) {
      throw new Error(`fact_trades has only ${rowCount.toLocaleString()} rows. Expected 130M+. Build fact_trades first.`);
    }
  } catch (e: any) {
    if (e.message.includes('doesn\'t exist')) {
      throw new Error('fact_trades table does not exist. Run build-fact-trades.ts first.');
    }
    throw e;
  }

  // Check resolutions
  const resolutionsCount = await ch.query({
    query: 'SELECT count() as count FROM default.market_resolutions_final',
    format: 'JSONEachRow'
  });
  const resRows = await resolutionsCount.json<Array<{ count: string }>>();
  const resCount = parseInt(resRows[0].count);
  console.log(`  market_resolutions_final: ${resCount.toLocaleString()} resolutions ✅\n`);

  // Step 1: Create realized P&L view
  console.log('Step 1: Creating vw_realized_pnl (resolved markets)...');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW default.vw_realized_pnl AS
      SELECT
        t.wallet_address,
        t.condition_id_norm,
        t.outcome_index,

        -- Position summary
        count() as trade_count,
        sum(t.shares_net) as total_shares,
        sum(t.cashflow_usdc_net) as cost_basis,

        -- Resolution data
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        r.resolved_at,

        -- P&L calculation
        multiIf(
          -- If this outcome won
          t.outcome_index = r.winning_index,
            (sum(t.shares_net) * arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - sum(t.cashflow_usdc_net),
          -- If outcome lost
          -sum(t.cashflow_usdc_net),
          -- Fallback
          0
        ) as realized_pnl,

        -- Metadata
        now() as calculated_at

      FROM default.fact_trades t

      -- Only include trades with market context
      WHERE t.has_market_context = 1

      -- Join to resolutions
      INNER JOIN default.market_resolutions_final r
        ON t.condition_id_norm = r.condition_id_norm

      GROUP BY
        t.wallet_address,
        t.condition_id_norm,
        t.outcome_index,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        r.resolved_at
    `
  });

  console.log('  ✅ vw_realized_pnl created');

  // Validate realized P&L
  const realizedStatsResult = await ch.query({
    query: `
      SELECT
        count(DISTINCT wallet_address) as wallets,
        count(DISTINCT condition_id_norm) as markets,
        sum(realized_pnl) as total_realized_pnl,
        avg(realized_pnl) as avg_pnl_per_position,
        countIf(realized_pnl > 0) as winning_positions,
        countIf(realized_pnl < 0) as losing_positions
      FROM default.vw_realized_pnl
    `,
    format: 'JSONEachRow'
  });

  const realizedStats = await realizedStatsResult.json<Array<any>>();
  const rs = realizedStats[0];

  console.log(`     Wallets: ${parseInt(rs.wallets).toLocaleString()}`);
  console.log(`     Markets: ${parseInt(rs.markets).toLocaleString()}`);
  console.log(`     Total realized P&L: $${parseFloat(rs.total_realized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  console.log(`     Winning positions: ${parseInt(rs.winning_positions).toLocaleString()}`);
  console.log(`     Losing positions: ${parseInt(rs.losing_positions).toLocaleString()}\n`);

  // Step 2: Create unrealized P&L view
  console.log('Step 2: Creating vw_unrealized_pnl (open markets)...');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW default.vw_unrealized_pnl AS
      SELECT
        t.wallet_address,
        t.condition_id_norm,
        t.outcome_index,

        -- Position summary
        count() as trade_count,
        sum(t.shares_net) as total_shares,
        sum(t.cashflow_usdc_net) as cost_basis,

        -- Current price (latest 5m candle)
        p.close as current_price,
        p.timestamp as price_timestamp,

        -- Unrealized P&L calculation
        (sum(t.shares_net) * p.close) - sum(t.cashflow_usdc_net) as unrealized_pnl,

        -- Metadata
        now() as calculated_at

      FROM default.fact_trades t

      -- Only include trades with market context
      WHERE t.has_market_context = 1

      -- Exclude resolved markets
      AND t.condition_id_norm NOT IN (
        SELECT condition_id_norm
        FROM default.market_resolutions_final
      )

      -- Join to latest price
      LEFT JOIN (
        SELECT
          condition_id_norm,
          outcome_index,
          close,
          timestamp,
          ROW_NUMBER() OVER (
            PARTITION BY condition_id_norm, outcome_index
            ORDER BY timestamp DESC
          ) as rn
        FROM default.market_candles_5m
        WHERE close IS NOT NULL
      ) p
        ON t.condition_id_norm = p.condition_id_norm
        AND t.outcome_index = p.outcome_index
        AND p.rn = 1

      GROUP BY
        t.wallet_address,
        t.condition_id_norm,
        t.outcome_index,
        p.close,
        p.timestamp
    `
  });

  console.log('  ✅ vw_unrealized_pnl created');

  // Validate unrealized P&L
  const unrealizedStatsResult = await ch.query({
    query: `
      SELECT
        count(DISTINCT wallet_address) as wallets,
        count(DISTINCT condition_id_norm) as markets,
        sum(unrealized_pnl) as total_unrealized_pnl,
        avg(unrealized_pnl) as avg_pnl_per_position,
        countIf(unrealized_pnl > 0) as winning_positions,
        countIf(unrealized_pnl < 0) as losing_positions,
        countIf(current_price IS NULL) as no_price_data
      FROM default.vw_unrealized_pnl
    `,
    format: 'JSONEachRow'
  });

  const unrealizedStats = await unrealizedStatsResult.json<Array<any>>();
  const us = unrealizedStats[0];

  console.log(`     Wallets: ${parseInt(us.wallets).toLocaleString()}`);
  console.log(`     Markets: ${parseInt(us.markets).toLocaleString()}`);
  console.log(`     Total unrealized P&L: $${parseFloat(us.total_unrealized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  console.log(`     Winning positions: ${parseInt(us.winning_positions).toLocaleString()}`);
  console.log(`     Losing positions: ${parseInt(us.losing_positions).toLocaleString()}`);
  console.log(`     No price data: ${parseInt(us.no_price_data).toLocaleString()}\n`);

  // Step 3: Create total P&L view
  console.log('Step 3: Creating vw_total_pnl (combined)...');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW default.vw_total_pnl AS
      SELECT
        coalesce(r.wallet_address, u.wallet_address) as wallet_address,

        -- Realized P&L
        coalesce(sum(r.realized_pnl), 0) as realized_pnl,
        count(DISTINCT r.condition_id_norm) as realized_markets,

        -- Unrealized P&L
        coalesce(sum(u.unrealized_pnl), 0) as unrealized_pnl,
        count(DISTINCT u.condition_id_norm) as unrealized_markets,

        -- Total P&L
        coalesce(sum(r.realized_pnl), 0) + coalesce(sum(u.unrealized_pnl), 0) as total_pnl,

        -- Summary stats
        count(DISTINCT r.condition_id_norm) + count(DISTINCT u.condition_id_norm) as total_markets,

        -- Metadata
        now() as calculated_at

      FROM (
        SELECT DISTINCT wallet_address FROM default.fact_trades WHERE has_market_context = 1
      ) wallets

      LEFT JOIN default.vw_realized_pnl r
        ON wallets.wallet_address = r.wallet_address

      LEFT JOIN default.vw_unrealized_pnl u
        ON wallets.wallet_address = u.wallet_address

      GROUP BY wallet_address
    `
  });

  console.log('  ✅ vw_total_pnl created');

  // Validate total P&L
  const totalStatsResult = await ch.query({
    query: `
      SELECT
        count() as wallets,
        sum(realized_pnl) as total_realized,
        sum(unrealized_pnl) as total_unrealized,
        sum(total_pnl) as total_pnl,
        avg(total_pnl) as avg_pnl_per_wallet,
        countIf(total_pnl > 0) as profitable_wallets,
        countIf(total_pnl < 0) as losing_wallets
      FROM default.vw_total_pnl
    `,
    format: 'JSONEachRow'
  });

  const totalStats = await totalStatsResult.json<Array<any>>();
  const ts = totalStats[0];

  console.log(`     Total wallets: ${parseInt(ts.wallets).toLocaleString()}`);
  console.log(`     Total realized P&L: $${parseFloat(ts.total_realized).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  console.log(`     Total unrealized P&L: $${parseFloat(ts.total_unrealized).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  console.log(`     Combined total P&L: $${parseFloat(ts.total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  console.log(`     Profitable wallets: ${parseInt(ts.profitable_wallets).toLocaleString()} (${(parseInt(ts.profitable_wallets)/parseInt(ts.wallets)*100).toFixed(1)}%)`);
  console.log(`     Losing wallets: ${parseInt(ts.losing_wallets).toLocaleString()} (${(parseInt(ts.losing_wallets)/parseInt(ts.wallets)*100).toFixed(1)}%)\n`);

  // Step 4: Test wallet validation
  console.log('Step 4: Testing wallet 0x4ce73141...');

  const testWalletResult = await ch.query({
    query: `
      SELECT
        realized_pnl,
        realized_markets,
        unrealized_pnl,
        unrealized_markets,
        total_pnl,
        total_markets
      FROM default.vw_total_pnl
      WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
    `,
    format: 'JSONEachRow'
  });

  const testWallet = await testWalletResult.json<Array<any>>();

  if (testWallet.length > 0) {
    const tw = testWallet[0];
    console.log(`  Realized P&L: $${parseFloat(tw.realized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})} (${tw.realized_markets} markets)`);
    console.log(`  Unrealized P&L: $${parseFloat(tw.unrealized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})} (${tw.unrealized_markets} markets)`);
    console.log(`  Total P&L: $${parseFloat(tw.total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
    console.log(`  Total markets: ${tw.total_markets}`);

    console.log('\n  📊 Polymarket UI shows: $332,566.88 all-time P&L');
    const pctDiff = Math.abs((parseFloat(tw.total_pnl) - 332566.88) / 332566.88 * 100);
    if (pctDiff < 10) {
      console.log(`  ✅ Difference: ${pctDiff.toFixed(1)}% - Within acceptable range!`);
    } else {
      console.log(`  ⚠️  Difference: ${pctDiff.toFixed(1)}% - May need investigation`);
    }
  } else {
    console.log('  ⚠️  Test wallet not found in P&L views');
  }

  // Step 5: Sample wallets
  console.log('\nStep 5: Sample wallet P&L...');

  const sampleResult = await ch.query({
    query: `
      SELECT
        wallet_address,
        realized_pnl,
        realized_markets,
        unrealized_pnl,
        unrealized_markets,
        total_pnl,
        total_markets
      FROM default.vw_total_pnl
      WHERE total_markets > 10
      ORDER BY rand()
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json<Array<any>>();

  console.log('\n  Sample wallets:');
  samples.forEach((s, i) => {
    console.log(`\n  ${i + 1}. Wallet: ${s.wallet_address.substring(0, 10)}...`);
    console.log(`     Realized P&L: $${parseFloat(s.realized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})} (${s.realized_markets} markets)`);
    console.log(`     Unrealized P&L: $${parseFloat(s.unrealized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})} (${s.unrealized_markets} markets)`);
    console.log(`     Total P&L: $${parseFloat(s.total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
    console.log(`     Total markets: ${s.total_markets}`);
  });

  console.log('\n✅ P&L views built successfully!');
  console.log('\n  Views created:');
  console.log('    - default.vw_realized_pnl (resolved markets)');
  console.log('    - default.vw_unrealized_pnl (open markets)');
  console.log('    - default.vw_total_pnl (combined)\n');

  console.log('  Usage examples:');
  console.log('    -- Get wallet total P&L');
  console.log('    SELECT * FROM default.vw_total_pnl WHERE wallet_address = \'0x...\'\n');
  console.log('    -- Top performers');
  console.log('    SELECT * FROM default.vw_total_pnl ORDER BY total_pnl DESC LIMIT 10\n');
  console.log('    -- Realized vs unrealized breakdown');
  console.log('    SELECT wallet_address, realized_pnl, unrealized_pnl FROM default.vw_total_pnl\n');

  await ch.close();
}

main().catch(console.error);
