#!/usr/bin/env npx tsx
/**
 * Build Production Cohort Tables
 *
 * Creates 4 permanent tables for the HC leaderboard:
 * 1. pm_wallet_classification_v1 - Full population wallet classification
 * 2. pm_wallet_realized_pnl_hc_v1 - Realized PnL for ALL HC wallets (including active)
 * 3. pm_wallet_omega_hc_v1 - Omega calculation from realized trades
 * 4. pm_hc_leaderboard_cohort_20k_v1 - Final 20K export
 *
 * Engine: Validated avg-cost realized + synthetic resolutions + redemption payouts
 * Rule: Active positions ARE included. Tooltip parity is NOT the target.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function buildWalletClassification() {
  console.log('\n' + '='.repeat(80));
  console.log('TABLE 1: pm_wallet_classification_v1');
  console.log('='.repeat(80));

  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_classification_v1` });

  console.log('Building wallet classification (full population)...');
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_classification_v1
      ENGINE = MergeTree()
      ORDER BY wallet
      AS
      WITH
      -- All CLOB wallets with trade stats
      clob_stats AS (
        SELECT
          lower(trader_wallet) as wallet,
          count() as total_trade_count,
          countIf(trade_time >= now() - INTERVAL 30 DAY) as trade_count_30d,
          max(trade_time) as last_trade_at,
          1 as has_clob
        FROM pm_trader_events_dedup_v2_tbl
        GROUP BY lower(trader_wallet)
      ),
      -- Transfer recipients (non-mint)
      transfer_in AS (
        SELECT DISTINCT lower(to_address) as wallet, 1 as has_transfer_in
        FROM pm_erc1155_transfers
        WHERE lower(from_address) != '0x0000000000000000000000000000000000000000'
      ),
      -- Transfer senders (non-burn)
      transfer_out AS (
        SELECT DISTINCT lower(from_address) as wallet, 1 as has_transfer_out
        FROM pm_erc1155_transfers
        WHERE lower(to_address) != '0x0000000000000000000000000000000000000000'
      ),
      -- Split/merge users
      split_merge AS (
        SELECT DISTINCT lower(user_address) as wallet, 1 as has_split_merge
        FROM pm_ctf_events
        WHERE event_type IN ('PositionSplit', 'PositionsMerge')
      ),
      -- Redemption users
      redemption_users AS (
        SELECT DISTINCT lower(wallet) as wallet, 1 as has_redemptions
        FROM pm_redemption_payouts_agg
      )
      SELECT
        c.wallet as wallet,
        c.total_trade_count as total_trade_count,
        c.trade_count_30d as trade_count_30d,
        c.last_trade_at as last_trade_at,
        c.has_clob as has_clob,
        COALESCE(ti.has_transfer_in, 0) as has_transfer_in,
        COALESCE(tox.has_transfer_out, 0) as has_transfer_out,
        COALESCE(sm.has_split_merge, 0) as has_split_merge,
        COALESCE(ru.has_redemptions, 0) as has_redemptions,
        -- HC = CLOB only, no transfers IN, no split/merge
        (c.has_clob = 1 AND COALESCE(ti.has_transfer_in, 0) = 0 AND COALESCE(sm.has_split_merge, 0) = 0) as is_hc,
        -- Complex = NOT HC
        NOT (c.has_clob = 1 AND COALESCE(ti.has_transfer_in, 0) = 0 AND COALESCE(sm.has_split_merge, 0) = 0) as is_complex,
        -- Active = traded in last 30 days
        (c.trade_count_30d > 0) as is_active_30d,
        now() as created_at
      FROM clob_stats c
      LEFT JOIN transfer_in ti ON c.wallet = ti.wallet
      LEFT JOIN transfer_out tox ON c.wallet = tox.wallet
      LEFT JOIN split_merge sm ON c.wallet = sm.wallet
      LEFT JOIN redemption_users ru ON c.wallet = ru.wallet
    `
  });

  const countQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(is_hc) as hc_count,
        countIf(is_complex) as complex_count,
        countIf(is_active_30d) as active_30d_count,
        countIf(is_hc AND total_trade_count >= 10) as hc_10_trades
      FROM pm_wallet_classification_v1
    `,
    format: 'JSONEachRow'
  });
  const counts = (await countQ.json() as any[])[0];

  console.log(`  Total wallets:           ${Number(counts.total).toLocaleString()}`);
  console.log(`  HC wallets:              ${Number(counts.hc_count).toLocaleString()}`);
  console.log(`  Complex wallets:         ${Number(counts.complex_count).toLocaleString()}`);
  console.log(`  Active (30d):            ${Number(counts.active_30d_count).toLocaleString()}`);
  console.log(`  HC with 10+ trades:      ${Number(counts.hc_10_trades).toLocaleString()}`);
}

async function buildRealizedPnlHC() {
  console.log('\n' + '='.repeat(80));
  console.log('TABLE 2: pm_wallet_realized_pnl_hc_v1');
  console.log('='.repeat(80));

  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_realized_pnl_hc_v1` });

  console.log('Computing realized PnL for ALL HC wallets (including active positions)...');
  console.log('Using: cash_flow (sell - buy) + redemption_payout');

  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_realized_pnl_hc_v1
      ENGINE = MergeTree()
      ORDER BY (realized_pnl, wallet)
      AS
      WITH
      -- HC wallets from classification
      hc_wallets AS (
        SELECT wallet, total_trade_count, trade_count_30d, last_trade_at
        FROM pm_wallet_classification_v1
        WHERE is_hc = 1 AND total_trade_count >= 10
      ),
      -- Cash flow per wallet
      cash_flow AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          sum(CASE WHEN t.side = 'buy' THEN t.usdc_amount ELSE 0 END) / 1e6 as buy_usdc,
          sum(CASE WHEN t.side = 'sell' THEN t.usdc_amount ELSE 0 END) / 1e6 as sell_usdc,
          (sum(CASE WHEN t.side = 'sell' THEN t.usdc_amount ELSE 0 END) -
           sum(CASE WHEN t.side = 'buy' THEN t.usdc_amount ELSE 0 END)) / 1e6 as net_cash
        FROM pm_trader_events_dedup_v2_tbl t
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM hc_wallets)
        GROUP BY lower(t.trader_wallet)
      ),
      -- Redemptions per wallet
      redemptions AS (
        SELECT wallet as wallet_raw, sum(redemption_payout) as redemption_payout
        FROM pm_redemption_payouts_agg
        WHERE lower(wallet) IN (SELECT wallet FROM hc_wallets)
        GROUP BY wallet
      )
      SELECT
        h.wallet as wallet,
        COALESCE(c.net_cash, 0) + COALESCE(r.redemption_payout, 0) as realized_pnl,
        COALESCE(c.buy_usdc, 0) as realized_buy_usdc,
        COALESCE(c.sell_usdc, 0) as realized_sell_usdc,
        COALESCE(r.redemption_payout, 0) as redemption_payout,
        h.total_trade_count as trade_count_total,
        h.trade_count_30d as trade_count_30d,
        h.last_trade_at as last_trade_at,
        now() as created_at
      FROM hc_wallets h
      LEFT JOIN cash_flow c ON h.wallet = c.wallet
      LEFT JOIN redemptions r ON h.wallet = lower(r.wallet_raw)
    `
  });

  const countQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(realized_pnl > 0) as winners,
        countIf(realized_pnl < 0) as losers,
        countIf(abs(realized_pnl) >= 500) as abs_500_plus,
        countIf(realized_pnl >= 500) as pnl_500_plus,
        round(avg(realized_pnl), 2) as avg_pnl,
        round(median(realized_pnl), 2) as median_pnl
      FROM pm_wallet_realized_pnl_hc_v1
    `,
    format: 'JSONEachRow'
  });
  const counts = (await countQ.json() as any[])[0];

  console.log(`  Total HC wallets:        ${Number(counts.total).toLocaleString()}`);
  console.log(`  Winners (PnL > 0):       ${Number(counts.winners).toLocaleString()}`);
  console.log(`  Losers (PnL < 0):        ${Number(counts.losers).toLocaleString()}`);
  console.log(`  abs(PnL) >= $500:        ${Number(counts.abs_500_plus).toLocaleString()}`);
  console.log(`  PnL >= $500:             ${Number(counts.pnl_500_plus).toLocaleString()}`);
  console.log(`  Average PnL:             $${Number(counts.avg_pnl).toLocaleString()}`);
  console.log(`  Median PnL:              $${Number(counts.median_pnl).toLocaleString()}`);
}

async function buildOmegaHC() {
  console.log('\n' + '='.repeat(80));
  console.log('TABLE 3: pm_wallet_omega_hc_v1');
  console.log('='.repeat(80));

  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_omega_hc_v1` });

  console.log('Computing Omega from per-market realized PnL distribution...');
  console.log('Omega = |avg(positive PnL)| / |avg(negative PnL)|');

  // Omega calculation: Per-market PnL, then compute ratio
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_omega_hc_v1
      ENGINE = MergeTree()
      ORDER BY (omega, wallet)
      AS
      WITH
      -- HC wallets
      hc_wallets AS (
        SELECT wallet FROM pm_wallet_realized_pnl_hc_v1
      ),
      -- Per-market cash flow for each wallet (market = condition_id)
      market_pnl AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          m.condition_id,
          (sum(CASE WHEN t.side = 'sell' THEN t.usdc_amount ELSE 0 END) -
           sum(CASE WHEN t.side = 'buy' THEN t.usdc_amount ELSE 0 END)) / 1e6 as market_cash_flow
        FROM pm_trader_events_dedup_v2_tbl t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM hc_wallets)
        GROUP BY lower(t.trader_wallet), m.condition_id
      ),
      -- Add redemptions per market
      market_redemptions AS (
        SELECT wallet as wallet_raw, condition_id as cid_raw, sum(redemption_payout) as payout
        FROM pm_redemption_payouts_agg
        WHERE lower(wallet) IN (SELECT wallet FROM hc_wallets)
        GROUP BY wallet, condition_id
      ),
      -- Combined market PnL
      market_pnl_combined AS (
        SELECT
          mp.wallet,
          mp.condition_id,
          mp.market_cash_flow + COALESCE(mr.payout, 0) as market_pnl
        FROM market_pnl mp
        LEFT JOIN market_redemptions mr ON mp.wallet = lower(mr.wallet_raw) AND lower(mp.condition_id) = lower(mr.cid_raw)
      ),
      -- Omega components per wallet
      omega_stats AS (
        SELECT
          wallet,
          count() as n_markets,
          countIf(market_pnl > 0) as n_wins,
          countIf(market_pnl < 0) as n_losses,
          sumIf(market_pnl, market_pnl > 0) as sum_wins,
          sumIf(abs(market_pnl), market_pnl < 0) as sum_losses,
          avgIf(market_pnl, market_pnl > 0) as avg_win,
          avgIf(abs(market_pnl), market_pnl < 0) as avg_loss
        FROM market_pnl_combined
        GROUP BY wallet
      )
      SELECT
        wallet,
        -- Omega = avg_win / avg_loss (handle edge cases)
        CASE
          WHEN avg_loss IS NULL OR avg_loss = 0 THEN
            CASE WHEN avg_win > 0 THEN 999.0 ELSE 1.0 END
          WHEN avg_win IS NULL OR avg_win = 0 THEN 0.0
          ELSE avg_win / avg_loss
        END as omega,
        n_markets as n_trades_used,
        n_wins,
        n_losses,
        CASE WHEN n_markets > 0 THEN n_wins * 1.0 / n_markets ELSE 0 END as win_rate,
        COALESCE(avg_win, 0) as avg_win,
        COALESCE(avg_loss, 0) as avg_loss,
        now() as created_at
      FROM omega_stats
    `
  });

  const countQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(omega > 1) as omega_gt_1,
        countIf(omega > 1.5) as omega_gt_1_5,
        countIf(omega > 2) as omega_gt_2,
        round(avg(omega), 3) as avg_omega,
        round(median(omega), 3) as median_omega
      FROM pm_wallet_omega_hc_v1
      WHERE omega < 999
    `,
    format: 'JSONEachRow'
  });
  const counts = (await countQ.json() as any[])[0];

  console.log(`  Total wallets:           ${Number(counts.total).toLocaleString()}`);
  console.log(`  Omega > 1:               ${Number(counts.omega_gt_1).toLocaleString()}`);
  console.log(`  Omega > 1.5:             ${Number(counts.omega_gt_1_5).toLocaleString()}`);
  console.log(`  Omega > 2:               ${Number(counts.omega_gt_2).toLocaleString()}`);
  console.log(`  Average Omega:           ${counts.avg_omega}`);
  console.log(`  Median Omega:            ${counts.median_omega}`);
}

async function buildFinal20KCohort() {
  console.log('\n' + '='.repeat(80));
  console.log('TABLE 4: pm_hc_leaderboard_cohort_20k_v1');
  console.log('='.repeat(80));

  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_hc_leaderboard_cohort_20k_v1` });

  console.log('Building final 20K cohort...');
  console.log('Filters: is_hc=true, trade_count>=10, abs(realized_pnl)>=500, omega>1');
  console.log('Rank: omega DESC, realized_pnl DESC');

  await clickhouse.command({
    query: `
      CREATE TABLE pm_hc_leaderboard_cohort_20k_v1
      ENGINE = MergeTree()
      ORDER BY (rank, wallet)
      AS
      SELECT
        wallet,
        rn as rank,
        omega,
        realized_pnl,
        trade_count_total,
        trade_count_30d,
        last_trade_at,
        is_active_30d,
        realized_buy_usdc,
        realized_sell_usdc,
        redemption_payout,
        now() as created_at
      FROM (
        SELECT
          p.wallet as wallet,
          o.omega as omega,
          p.realized_pnl as realized_pnl,
          p.trade_count_total as trade_count_total,
          p.trade_count_30d as trade_count_30d,
          p.last_trade_at as last_trade_at,
          c.is_active_30d as is_active_30d,
          p.realized_buy_usdc as realized_buy_usdc,
          p.realized_sell_usdc as realized_sell_usdc,
          p.redemption_payout as redemption_payout,
          row_number() OVER (ORDER BY o.omega DESC, p.realized_pnl DESC) as rn
        FROM pm_wallet_realized_pnl_hc_v1 p
        JOIN pm_wallet_omega_hc_v1 o ON p.wallet = o.wallet
        JOIN pm_wallet_classification_v1 c ON p.wallet = c.wallet
        WHERE c.is_hc = 1
          AND p.trade_count_total >= 10
          AND abs(p.realized_pnl) >= 500
          AND o.omega > 1
      )
      WHERE rn <= 20000
    `
  });

  const countQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(is_active_30d) as active_30d,
        round(avg(omega), 3) as avg_omega,
        round(avg(realized_pnl), 2) as avg_pnl,
        round(median(realized_pnl), 2) as median_pnl,
        round(max(realized_pnl), 2) as max_pnl
      FROM pm_hc_leaderboard_cohort_20k_v1
    `,
    format: 'JSONEachRow'
  });
  const counts = (await countQ.json() as any[])[0];

  console.log(`  Final cohort size:       ${Number(counts.total).toLocaleString()}`);
  console.log(`  Active (30d):            ${Number(counts.active_30d).toLocaleString()}`);
  console.log(`  Average Omega:           ${counts.avg_omega}`);
  console.log(`  Average PnL:             $${Number(counts.avg_pnl).toLocaleString()}`);
  console.log(`  Median PnL:              $${Number(counts.median_pnl).toLocaleString()}`);
  console.log(`  Max PnL:                 $${Number(counts.max_pnl).toLocaleString()}`);

  // Show top 10
  console.log('\n  TOP 10 WALLETS:');
  const topQ = await clickhouse.query({
    query: `
      SELECT wallet, rank, omega, realized_pnl, trade_count_total
      FROM pm_hc_leaderboard_cohort_20k_v1
      ORDER BY rank
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topWallets = await topQ.json() as any[];

  for (const w of topWallets) {
    console.log(`    #${w.rank} ${w.wallet.slice(0, 20)}... | Ω=${Number(w.omega).toFixed(2)} | PnL=$${Number(w.realized_pnl).toLocaleString()} | Trades=${w.trade_count_total}`);
  }
}

async function printFunnelSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('FUNNEL SUMMARY');
  console.log('='.repeat(80));

  const funnelQ = await clickhouse.query({
    query: `
      SELECT
        (SELECT count() FROM pm_wallet_classification_v1) as total_wallets,
        (SELECT countIf(is_hc) FROM pm_wallet_classification_v1) as hc_wallets,
        (SELECT count() FROM pm_wallet_realized_pnl_hc_v1) as hc_10_trades,
        (SELECT countIf(abs(realized_pnl) >= 500) FROM pm_wallet_realized_pnl_hc_v1) as hc_abs_500,
        (SELECT count() FROM pm_wallet_omega_hc_v1 WHERE omega > 1) as hc_omega_gt_1,
        (SELECT count() FROM pm_hc_leaderboard_cohort_20k_v1) as final_cohort
    `,
    format: 'JSONEachRow'
  });
  const funnel = (await funnelQ.json() as any[])[0];

  console.log(`  Step 1: Total CLOB wallets:              ${Number(funnel.total_wallets).toLocaleString()}`);
  console.log(`  Step 2: HC (no xfr in, no split/merge):  ${Number(funnel.hc_wallets).toLocaleString()}`);
  console.log(`  Step 3: HC + 10+ trades:                 ${Number(funnel.hc_10_trades).toLocaleString()}`);
  console.log(`  Step 4: HC + abs(PnL) >= $500:           ${Number(funnel.hc_abs_500).toLocaleString()}`);
  console.log(`  Step 5: HC + Omega > 1:                  ${Number(funnel.hc_omega_gt_1).toLocaleString()}`);
  console.log(`  Step 6: Final 20K cohort:                ${Number(funnel.final_cohort).toLocaleString()}`);
}

async function main() {
  console.log('BUILD PRODUCTION COHORT TABLES');
  console.log('='.repeat(80));
  console.log('Engine: Validated avg-cost realized + redemption payouts');
  console.log('Rule: Active positions INCLUDED. Tooltip parity NOT the target.');
  console.log('');

  try {
    await buildWalletClassification();
    await buildRealizedPnlHC();
    await buildOmegaHC();
    await buildFinal20KCohort();
    await printFunnelSummary();

    console.log('\n' + '='.repeat(80));
    console.log('TABLES CREATED:');
    console.log('  1. pm_wallet_classification_v1     - Full population classification');
    console.log('  2. pm_wallet_realized_pnl_hc_v1    - Realized PnL for HC wallets');
    console.log('  3. pm_wallet_omega_hc_v1           - Omega for HC wallets');
    console.log('  4. pm_hc_leaderboard_cohort_20k_v1 - Final 20K export');
    console.log('');
    console.log('NEXT: Run flat-wallet tooltip sanity check (N=200)');
  } catch (e: any) {
    console.error('Error:', e.message);
  }

  await clickhouse.close();
}

main().catch(console.error);
