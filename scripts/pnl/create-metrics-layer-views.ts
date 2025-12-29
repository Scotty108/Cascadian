#!/usr/bin/env npx tsx
/**
 * CREATE METRICS LAYER VIEWS FOR COPY-TRADING
 * ============================================================================
 *
 * Creates aggregated views on top of Tier A for copy-trading rankings:
 * - total_pnl_synthetic_realized
 * - pnl_by_category
 * - omega_ratio_overall
 * - omega_ratio_by_category
 * - time_in_trade
 *
 * These are the foundation for copy-trading leaderboard rankings.
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 600000,
});

async function createViews() {
  console.log('═'.repeat(80));
  console.log('CREATING METRICS LAYER VIEWS FOR COPY-TRADING');
  console.log('═'.repeat(80));
  console.log('');

  // ============================================================================
  // View 1: Tier A Realized PnL Summary (total_pnl_synthetic_realized)
  // ============================================================================
  console.log('Creating vw_tierA_realized_pnl_summary...');

  await ch.command({
    query: 'DROP VIEW IF EXISTS vw_tierA_realized_pnl_summary'
  });

  await ch.command({
    query: `
      CREATE VIEW vw_tierA_realized_pnl_summary AS
      SELECT
        d.wallet_address,
        sum(d.usdc_delta) as total_usdc_flow,
        sum(d.token_delta) as total_token_delta,
        sumIf(
          d.usdc_delta + d.token_delta * arrayElement(res.norm_prices, toInt32(m.outcome_index + 1)),
          res.raw_numerators IS NOT NULL
          AND res.raw_numerators != ''
          AND length(res.norm_prices) > 0
          AND m.outcome_index IS NOT NULL
        ) as realized_pnl,
        count(*) as total_events,
        countIf(res.raw_numerators IS NOT NULL AND res.raw_numerators != '' AND length(res.norm_prices) > 0) as resolved_events,
        countIf(res.raw_numerators IS NULL OR res.raw_numerators = '' OR length(res.norm_prices) = 0) as unresolved_events,
        if(count(*) > 0, countIf(res.raw_numerators IS NULL OR res.raw_numerators = '' OR length(res.norm_prices) = 0) * 100.0 / count(*), 0) as unresolved_pct
      FROM (
        SELECT
          trader_wallet as wallet_address,
          event_id,
          argMax(token_id, trade_time) as tok_id,
          argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
          argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trader_wallet IN (SELECT wallet_address FROM trader_strict_classifier_v1 WHERE tier = 'A')
        GROUP BY trader_wallet, event_id
      ) d
      LEFT JOIN pm_token_to_condition_map_v5 m ON d.tok_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions_norm res ON m.condition_id = res.condition_id
      GROUP BY d.wallet_address
    `
  });
  console.log('  ✓ Created');

  // ============================================================================
  // View 2: PnL by Category
  // ============================================================================
  console.log('Creating vw_tierA_pnl_by_category...');

  await ch.command({
    query: 'DROP VIEW IF EXISTS vw_tierA_pnl_by_category'
  });

  await ch.command({
    query: `
      CREATE VIEW vw_tierA_pnl_by_category AS
      SELECT
        d.wallet_address,
        coalesce(meta.category, 'Unknown') as category,
        sumIf(
          d.usdc_delta + d.token_delta * arrayElement(res.norm_prices, toInt32(m.outcome_index + 1)),
          res.raw_numerators IS NOT NULL
          AND res.raw_numerators != ''
          AND length(res.norm_prices) > 0
          AND m.outcome_index IS NOT NULL
        ) as realized_pnl,
        count(*) as events,
        count(DISTINCT m.condition_id) as unique_markets
      FROM (
        SELECT
          trader_wallet as wallet_address,
          event_id,
          argMax(token_id, trade_time) as tok_id,
          argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
          argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trader_wallet IN (SELECT wallet_address FROM trader_strict_classifier_v1 WHERE tier = 'A')
        GROUP BY trader_wallet, event_id
      ) d
      LEFT JOIN pm_token_to_condition_map_v5 m ON d.tok_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions_norm res ON m.condition_id = res.condition_id
      LEFT JOIN pm_market_metadata meta ON m.condition_id = meta.condition_id
      GROUP BY d.wallet_address, coalesce(meta.category, 'Unknown')
    `
  });
  console.log('  ✓ Created');

  // ============================================================================
  // View 3: Win/Loss Stats for Omega Ratio
  // ============================================================================
  console.log('Creating vw_tierA_win_loss_stats...');

  await ch.command({
    query: 'DROP VIEW IF EXISTS vw_tierA_win_loss_stats'
  });

  await ch.command({
    query: `
      CREATE VIEW vw_tierA_win_loss_stats AS
      SELECT
        d.wallet_address,
        m.condition_id as condition_id,
        sum(d.usdc_delta) as market_usdc_flow,
        sum(d.token_delta) as market_token_delta,
        if(
          res.raw_numerators IS NOT NULL AND res.raw_numerators != '' AND length(res.norm_prices) > 0,
          sum(d.usdc_delta) + sum(d.token_delta) * arrayElement(res.norm_prices, toInt32(any(m.outcome_index) + 1)),
          NULL
        ) as market_realized_pnl,
        res.raw_numerators IS NOT NULL AND res.raw_numerators != '' AND length(res.norm_prices) > 0 as is_resolved
      FROM (
        SELECT
          trader_wallet as wallet_address,
          event_id,
          argMax(token_id, trade_time) as tok_id,
          argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
          argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trader_wallet IN (SELECT wallet_address FROM trader_strict_classifier_v1 WHERE tier = 'A')
        GROUP BY trader_wallet, event_id
      ) d
      LEFT JOIN pm_token_to_condition_map_v5 m ON d.tok_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions_norm res ON m.condition_id = res.condition_id
      WHERE m.condition_id IS NOT NULL
      GROUP BY d.wallet_address, m.condition_id, res.raw_numerators, res.norm_prices
    `
  });
  console.log('  ✓ Created');

  // ============================================================================
  // View 4: Omega Ratio (Overall)
  // ============================================================================
  console.log('Creating vw_tierA_omega_ratio...');

  await ch.command({
    query: 'DROP VIEW IF EXISTS vw_tierA_omega_ratio'
  });

  await ch.command({
    query: `
      CREATE VIEW vw_tierA_omega_ratio AS
      SELECT
        wallet_address,
        count(*) as total_markets,
        countIf(is_resolved) as resolved_markets,
        countIf(is_resolved AND market_realized_pnl > 0) as winning_markets,
        countIf(is_resolved AND market_realized_pnl <= 0) as losing_markets,
        sumIf(market_realized_pnl, is_resolved AND market_realized_pnl > 0) as total_gains,
        abs(sumIf(market_realized_pnl, is_resolved AND market_realized_pnl <= 0)) as total_losses,
        if(countIf(is_resolved) > 0,
           countIf(is_resolved AND market_realized_pnl > 0) * 100.0 / countIf(is_resolved),
           0) as win_rate_pct,
        if(abs(sumIf(market_realized_pnl, is_resolved AND market_realized_pnl <= 0)) > 0,
           sumIf(market_realized_pnl, is_resolved AND market_realized_pnl > 0) / abs(sumIf(market_realized_pnl, is_resolved AND market_realized_pnl <= 0)),
           if(sumIf(market_realized_pnl, is_resolved AND market_realized_pnl > 0) > 0, 999.99, 0)) as omega_ratio
      FROM vw_tierA_win_loss_stats
      GROUP BY wallet_address
    `
  });
  console.log('  ✓ Created');

  // ============================================================================
  // View 5: Omega Ratio by Category
  // ============================================================================
  console.log('Creating vw_tierA_omega_ratio_by_category...');

  await ch.command({
    query: 'DROP VIEW IF EXISTS vw_tierA_omega_ratio_by_category'
  });

  await ch.command({
    query: `
      CREATE VIEW vw_tierA_omega_ratio_by_category AS
      SELECT
        w.wallet_address,
        coalesce(meta.category, 'Unknown') as category,
        count(*) as total_markets,
        countIf(w.is_resolved) as resolved_markets,
        countIf(w.is_resolved AND w.market_realized_pnl > 0) as winning_markets,
        countIf(w.is_resolved AND w.market_realized_pnl <= 0) as losing_markets,
        sumIf(w.market_realized_pnl, w.is_resolved AND w.market_realized_pnl > 0) as total_gains,
        abs(sumIf(w.market_realized_pnl, w.is_resolved AND w.market_realized_pnl <= 0)) as total_losses,
        if(countIf(w.is_resolved) > 0,
           countIf(w.is_resolved AND w.market_realized_pnl > 0) * 100.0 / countIf(w.is_resolved),
           0) as win_rate_pct,
        if(abs(sumIf(w.market_realized_pnl, w.is_resolved AND w.market_realized_pnl <= 0)) > 0,
           sumIf(w.market_realized_pnl, w.is_resolved AND w.market_realized_pnl > 0) / abs(sumIf(w.market_realized_pnl, w.is_resolved AND w.market_realized_pnl <= 0)),
           if(sumIf(w.market_realized_pnl, w.is_resolved AND w.market_realized_pnl > 0) > 0, 999.99, 0)) as omega_ratio
      FROM vw_tierA_win_loss_stats w
      LEFT JOIN pm_market_metadata meta ON w.condition_id = meta.condition_id
      GROUP BY w.wallet_address, coalesce(meta.category, 'Unknown')
    `
  });
  console.log('  ✓ Created');

  // ============================================================================
  // View 6: Time in Trade (Average holding period)
  // ============================================================================
  console.log('Creating vw_tierA_time_in_trade...');

  await ch.command({
    query: 'DROP VIEW IF EXISTS vw_tierA_time_in_trade'
  });

  await ch.command({
    query: `
      CREATE VIEW vw_tierA_time_in_trade AS
      SELECT
        wallet_address,
        count(DISTINCT condition_id) as markets_traded,
        avg(dateDiff('day', first_trade, last_trade)) as avg_holding_days,
        avg(dateDiff('hour', first_trade, last_trade)) as avg_holding_hours,
        min(first_trade) as first_ever_trade,
        max(last_trade) as last_ever_trade
      FROM (
        SELECT
          trader_wallet as wallet_address,
          m.condition_id,
          min(trade_time) as first_trade,
          max(trade_time) as last_trade
        FROM pm_trader_events_v2 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE t.is_deleted = 0
          AND t.trader_wallet IN (SELECT wallet_address FROM trader_strict_classifier_v1 WHERE tier = 'A')
          AND m.condition_id IS NOT NULL
        GROUP BY t.trader_wallet, m.condition_id
      )
      GROUP BY wallet_address
    `
  });
  console.log('  ✓ Created');

  // ============================================================================
  // Verify views
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('VERIFYING VIEWS');
  console.log('─'.repeat(80));

  const views = [
    'vw_tierA_realized_pnl_summary',
    'vw_tierA_pnl_by_category',
    'vw_tierA_win_loss_stats',
    'vw_tierA_omega_ratio',
    'vw_tierA_omega_ratio_by_category',
    'vw_tierA_time_in_trade'
  ];

  for (const view of views) {
    try {
      const result = await ch.query({
        query: `SELECT count() as cnt FROM ${view} LIMIT 1`,
        format: 'JSONEachRow'
      });
      const data = await result.json<any[]>();
      console.log(`  ✓ ${view}: accessible`);
    } catch (err: any) {
      console.log(`  ✗ ${view}: ${err.message}`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('METRICS LAYER VIEWS CREATED');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Views created:');
  console.log('  1. vw_tierA_realized_pnl_summary - Total synthetic realized PnL');
  console.log('  2. vw_tierA_pnl_by_category - PnL broken down by market category');
  console.log('  3. vw_tierA_win_loss_stats - Per-market win/loss for omega calculation');
  console.log('  4. vw_tierA_omega_ratio - Overall omega ratio (gains/losses)');
  console.log('  5. vw_tierA_omega_ratio_by_category - Omega ratio by category');
  console.log('  6. vw_tierA_time_in_trade - Average holding period');
  console.log('');
  console.log('Usage example:');
  console.log('  SELECT wallet_address, realized_pnl, win_rate_pct, omega_ratio');
  console.log('  FROM vw_tierA_omega_ratio');
  console.log('  WHERE resolved_markets >= 10');
  console.log('  ORDER BY omega_ratio DESC');
  console.log('  LIMIT 100');
}

async function main() {
  try {
    await createViews();
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
