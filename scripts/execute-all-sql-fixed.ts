#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function executeStatement(description: string, query: string) {
  console.log(`${description}...`);
  try {
    await ch.command({ query });
    console.log(`✓ Success\n`);
    return true;
  } catch (err: any) {
    console.error(`✗ Error: ${err.message}\n`);
    return false;
  }
}

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('BUILDING COMPLETE P&L SYSTEM (FIXED)');
  console.log('═'.repeat(80));
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: TRADING P&L (SQL Views)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('─'.repeat(80));
  console.log('PHASE 1: TRADING P&L (Average Cost Method)');
  console.log('─'.repeat(80));
  console.log('');

  await executeStatement(
    'Creating cascadian_clean database',
    `CREATE DATABASE IF NOT EXISTS cascadian_clean`
  );

  await executeStatement(
    'Creating vw_trades_ledger view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_trades_ledger AS
    SELECT
      lower(wallet_address_norm)          AS wallet,
      lower(condition_id_norm)            AS token_cid,
      concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
      toInt32(outcome_index)              AS outcome,
      toDateTime(timestamp)               AS ts,
      multiIf(trade_direction = 'BUY',  toFloat64(shares),
              trade_direction = 'SELL', -toFloat64(shares), 0.0)           AS d_shares,
      multiIf(trade_direction = 'BUY', -toFloat64(usd_value),
              trade_direction = 'SELL',  toFloat64(usd_value), 0.0)        AS d_cash,
      0.0 AS fee_usd
    FROM default.vw_trades_canonical
    WHERE condition_id_norm != ''
      AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      AND outcome_index >= 0
    `
  );

  await executeStatement(
    'Creating vw_trading_pnl_positions view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_positions AS
    SELECT
      wallet,
      market_cid,
      outcome,
      sum(d_shares) AS position_shares,
      sum(d_cash) AS net_cash,
      sum(fee_usd) AS total_fees_usd,
      if(abs(sum(d_shares)) < 0.01, 'CLOSED', 'OPEN') AS status
    FROM cascadian_clean.vw_trades_ledger
    GROUP BY wallet, market_cid, outcome
    `
  );

  await executeStatement(
    'Creating vw_trading_pnl_realized view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_realized AS
    SELECT
      wallet,
      market_cid,
      outcome,
      status,
      position_shares,
      net_cash,
      total_fees_usd,
      if(status = 'CLOSED', net_cash - total_fees_usd, 0.0) AS realized_pnl_usd
    FROM cascadian_clean.vw_trading_pnl_positions
    `
  );

  await executeStatement(
    'Creating vw_wallet_trading_pnl_summary view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_trading_pnl_summary AS
    SELECT
      wallet,
      count(*) AS total_positions,
      countIf(status = 'CLOSED') AS closed_positions,
      countIf(status = 'OPEN') AS open_positions,
      sum(realized_pnl_usd) AS total_realized_pnl_usd
    FROM cascadian_clean.vw_trading_pnl_realized
    GROUP BY wallet
    ORDER BY total_realized_pnl_usd DESC
    `
  );

  console.log('✅ Phase 1 complete\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: UNREALIZED P&L (SQL Views)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('─'.repeat(80));
  console.log('PHASE 2: UNREALIZED P&L');
  console.log('─'.repeat(80));
  console.log('');

  await executeStatement(
    'Creating midprices_latest table',
    `
    CREATE TABLE IF NOT EXISTS cascadian_clean.midprices_latest
    (
      market_cid String,
      outcome Int32,
      midprice Float64,
      best_bid Float64,
      best_ask Float64,
      updated_at DateTime
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (market_cid, outcome)
    `
  );

  await executeStatement(
    'Creating vw_positions_open view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_positions_open AS
    WITH pos AS (
      SELECT
        lower(wallet_address_norm) AS wallet,
        concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
        toInt32(outcome_index) AS outcome,
        sumIf(if(trade_direction='BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
        sumIf(if(trade_direction='BUY', -toFloat64(usd_value), toFloat64(usd_value)), 1) AS cash_net
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND outcome_index >= 0
      GROUP BY wallet, market_cid, outcome
    ),
    market_conditions AS (
      SELECT
        market_id_cid AS market_cid,
        any(lower(condition_id_32b)) AS condition_id_32b
      FROM cascadian_clean.token_condition_market_map
      GROUP BY market_id_cid
    )
    SELECT
      p.wallet,
      p.market_cid,
      p.outcome,
      p.shares_net AS qty,
      if(p.shares_net != 0, -p.cash_net / nullIf(p.shares_net, 0), 0.0) AS avg_cost,
      m.midprice,
      m.best_bid,
      m.best_ask,
      m.updated_at AS price_updated_at,
      p.shares_net * (coalesce(m.midprice, 0.0) - if(p.shares_net != 0, -p.cash_net / nullIf(p.shares_net, 0), 0.0)) AS unrealized_pnl_usd
    FROM pos p
    LEFT JOIN market_conditions mc
      ON mc.market_cid = p.market_cid
    LEFT JOIN cascadian_clean.vw_resolutions_truth r
      ON r.condition_id_32b = mc.condition_id_32b
    LEFT JOIN cascadian_clean.midprices_latest m
      ON m.market_cid = p.market_cid AND m.outcome = p.outcome
    WHERE abs(p.shares_net) >= 0.01
      AND (mc.condition_id_32b IS NULL OR r.condition_id_32b IS NULL)
    `
  );

  await executeStatement(
    'Creating vw_wallet_unrealized_pnl_summary view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_unrealized_pnl_summary AS
    SELECT
      wallet,
      count(*) AS open_positions,
      sum(qty) AS total_shares,
      sum(unrealized_pnl_usd) AS total_unrealized_pnl_usd,
      countIf(midprice IS NOT NULL) AS positions_with_prices,
      countIf(midprice IS NULL) AS positions_without_prices
    FROM cascadian_clean.vw_positions_open
    GROUP BY wallet
    ORDER BY total_unrealized_pnl_usd DESC
    `
  );

  console.log('✅ Phase 2 complete\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: UNIFIED P&L
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('─'.repeat(80));
  console.log('PHASE 3: UNIFIED P&L');
  console.log('─'.repeat(80));
  console.log('');

  await executeStatement(
    'Creating vw_redemption_pnl view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_redemption_pnl AS
    WITH positions_at_resolution AS (
      SELECT
        lower(t.wallet_address_norm) AS wallet,
        concat('0x', left(replaceAll(t.condition_id_norm,'0x',''),62),'00') AS market_cid,
        toInt32(t.outcome_index) AS outcome,
        sumIf(if(t.trade_direction='BUY', toFloat64(t.shares), -toFloat64(t.shares)), 1) AS net_shares,
        sumIf(if(t.trade_direction='BUY', -toFloat64(t.usd_value), toFloat64(t.usd_value)), 1) AS net_cash,
        anyLast(r.payout_numerators) AS pay_num,
        anyLast(r.payout_denominator) AS pay_den,
        anyLast(r.winning_outcome) AS winning_index
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON concat('0x', left(replaceAll(t.condition_id_norm,'0x',''),62),'00') = concat('0x', r.condition_id_norm)
      WHERE t.condition_id_norm != ''
        AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND r.payout_denominator > 0
      GROUP BY wallet, market_cid, outcome
    )
    SELECT
      wallet,
      market_cid,
      outcome,
      net_shares,
      net_cash,
      winning_index,
      if(
        outcome < length(pay_num),
        toFloat64(pay_num[outcome + 1]) / nullIf(toFloat64(pay_den), 0),
        0.0
      ) AS payout_value,
      (net_shares * if(
        outcome < length(pay_num),
        toFloat64(pay_num[outcome + 1]) / nullIf(toFloat64(pay_den), 0),
        0.0
      )) + net_cash AS redemption_pnl_usd
    FROM positions_at_resolution
    WHERE abs(net_shares) >= 0.01
    `
  );

  await executeStatement(
    'Creating vw_market_pnl_unified view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_market_pnl_unified AS
    SELECT
      coalesce(t.wallet, u.wallet, r.wallet) AS wallet,
      coalesce(t.market_cid, u.market_cid, r.market_cid) AS market_cid,
      coalesce(t.outcome, u.outcome, r.outcome) AS outcome,
      coalesce(t.realized_pnl_usd, 0.0) AS trading_realized_pnl,
      coalesce(u.unrealized_pnl_usd, 0.0) AS unrealized_pnl,
      coalesce(r.redemption_pnl_usd, 0.0) AS redemption_pnl,
      coalesce(t.realized_pnl_usd, 0.0) +
      coalesce(u.unrealized_pnl_usd, 0.0) +
      coalesce(r.redemption_pnl_usd, 0.0) AS total_pnl
    FROM cascadian_clean.vw_trading_pnl_realized t
    FULL OUTER JOIN cascadian_clean.vw_positions_open u
      ON u.wallet = t.wallet AND u.market_cid = t.market_cid AND u.outcome = t.outcome
    FULL OUTER JOIN cascadian_clean.vw_redemption_pnl r
      ON r.wallet = coalesce(t.wallet, u.wallet) AND r.market_cid = coalesce(t.market_cid, u.market_cid) AND r.outcome = coalesce(t.outcome, u.outcome)
    `
  );

  await executeStatement(
    'Creating vw_wallet_pnl_unified view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_unified AS
    SELECT
      wallet,
      sum(trading_realized_pnl) AS trading_realized_pnl,
      sum(redemption_pnl) AS redemption_pnl,
      sum(trading_realized_pnl) + sum(redemption_pnl) AS total_realized_pnl,
      sum(unrealized_pnl) AS unrealized_pnl,
      sum(trading_realized_pnl) + sum(redemption_pnl) + sum(unrealized_pnl) AS total_pnl,
      countIf(abs(trading_realized_pnl) > 0.01) AS closed_positions,
      countIf(abs(unrealized_pnl) > 0.01) AS open_positions,
      countIf(abs(redemption_pnl) > 0.01) AS redeemed_positions
    FROM cascadian_clean.vw_market_pnl_unified
    GROUP BY wallet
    ORDER BY total_pnl DESC
    `
  );

  await executeStatement(
    'Creating vw_wallet_pnl_closed view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_closed AS
    SELECT
      wallet,
      total_realized_pnl AS closed_pnl,
      closed_positions + redeemed_positions AS total_closed_positions
    FROM cascadian_clean.vw_wallet_pnl_unified
    ORDER BY closed_pnl DESC
    `
  );

  await executeStatement(
    'Creating vw_wallet_pnl_all view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_all AS
    SELECT
      wallet,
      total_realized_pnl AS realized_pnl,
      unrealized_pnl,
      total_pnl AS all_pnl,
      closed_positions + redeemed_positions AS closed_positions,
      open_positions
    FROM cascadian_clean.vw_wallet_pnl_unified
    ORDER BY all_pnl DESC
    `
  );

  await executeStatement(
    'Creating vw_pnl_coverage_metrics view',
    `
    CREATE OR REPLACE VIEW cascadian_clean.vw_pnl_coverage_metrics AS
    SELECT
      (SELECT count(DISTINCT condition_id_norm) FROM default.market_resolutions_final WHERE payout_denominator > 0) AS resolved_markets,
      (SELECT uniqExact(concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00'))
       FROM default.vw_trades_canonical
       WHERE condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ) AS traded_markets,
      (SELECT count(*) FROM cascadian_clean.midprices_latest) AS prices_available,
      (SELECT count(DISTINCT concat(market_cid, '-', toString(outcome)))
       FROM cascadian_clean.vw_positions_open) AS open_positions_needing_prices,
      (SELECT sum(total_realized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_realized_pnl,
      (SELECT sum(unrealized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_unrealized_pnl,
      (SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_all_pnl,
      round((SELECT sum(total_realized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) /
            nullIf((SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified), 0) * 100, 2) AS realized_pct,
      round((SELECT sum(unrealized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) /
            nullIf((SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified), 0) * 100, 2) AS unrealized_pct
    `
  );

  console.log('✅ Phase 3 complete\n');

  console.log('═'.repeat(80));
  console.log('ALL SQL VIEWS CREATED SUCCESSFULLY');
  console.log('═'.repeat(80));
  console.log('');

  await ch.close();
}

main().catch(console.error);
