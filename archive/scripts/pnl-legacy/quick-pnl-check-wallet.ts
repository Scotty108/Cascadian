#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log(`🔍 Checking P&L capability for wallet ${wallet}\n`);

  // 1. Check what trades we have
  console.log('━━━ STEP 1: Trades Coverage ━━━');
  const tradesResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        uniqExact(lower(replaceAll(condition_id, '0x', ''))) as unique_markets,
        sum(abs(toFloat64(cashflow_usdc))) as total_volume_usd,
        min(created_at) as first_trade,
        max(created_at) as last_trade
      FROM default.trades_raw
      WHERE lower(wallet) = '${wallet}'
        AND length(replaceAll(condition_id, '0x', '')) = 64
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesResult.json<Array<any>>();
  console.log(`  Total trades: ${parseInt(trades[0].total_trades).toLocaleString()}`);
  console.log(`  Unique markets: ${parseInt(trades[0].unique_markets).toLocaleString()}`);
  console.log(`  Total volume: $${parseFloat(trades[0].total_volume_usd).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Time range: ${trades[0].first_trade} → ${trades[0].last_trade}\n`);

  // 2. Check resolution coverage
  console.log('━━━ STEP 2: Resolution Coverage ━━━');
  const resolutionResult = await clickhouse.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
        FROM default.trades_raw
        WHERE lower(wallet) = '${wallet}'
          AND length(replaceAll(condition_id, '0x', '')) = 64
      )
      SELECT
        count() as total_markets,
        countIf(res.condition_id_norm IS NOT NULL) as with_resolution,
        countIf(res.condition_id_norm IS NULL) as without_resolution,
        (countIf(res.condition_id_norm IS NOT NULL) * 100.0 / count()) as pct_coverage
      FROM wallet_markets w
      LEFT JOIN default.market_resolutions_final res
        ON w.condition_id_norm = res.condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const resolution = await resolutionResult.json<Array<any>>();
  console.log(`  Markets with resolutions: ${parseInt(resolution[0].with_resolution).toLocaleString()} / ${parseInt(resolution[0].total_markets).toLocaleString()} (${parseFloat(resolution[0].pct_coverage).toFixed(1)}%)`);
  console.log(`  Markets without resolutions: ${parseInt(resolution[0].without_resolution).toLocaleString()}\n`);

  // 3. Calculate P&L for resolved markets
  console.log('━━━ STEP 3: P&L Calculation (Resolved Markets Only) ━━━');
  const pnlResult = await clickhouse.query({
    query: `
      WITH trades_with_res AS (
        SELECT
          t.wallet,
          t.condition_id,
          lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
          t.outcome_index,
          t.trade_direction,
          toFloat64(t.shares) as shares,
          toFloat64(t.cashflow_usdc) as cashflow_usd,
          res.payout_numerators,
          res.payout_denominator,
          res.winning_index
        FROM default.trades_raw t
        INNER JOIN default.market_resolutions_final res
          ON lower(replaceAll(t.condition_id, '0x', '')) = res.condition_id_norm
        WHERE lower(t.wallet) = '${wallet}'
          AND length(replaceAll(t.condition_id, '0x', '')) = 64
      ),
      position_pnl AS (
        SELECT
          condition_id_norm,
          outcome_index,
          sum(if(trade_direction = 'BUY', shares, -shares)) as net_shares,
          sum(cashflow_usd) as net_cashflow_usd,
          any(payout_numerators) as payout_numerators,
          any(payout_denominator) as payout_denominator,
          any(winning_index) as winning_index
        FROM trades_with_res
        GROUP BY condition_id_norm, outcome_index
      )
      SELECT
        count() as total_positions,
        sum(net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) + net_cashflow_usd) as total_pnl,
        sumIf(net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) + net_cashflow_usd,
              (net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) + net_cashflow_usd) > 0) as total_profit,
        sumIf(net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) + net_cashflow_usd,
              (net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) + net_cashflow_usd) < 0) as total_loss
      FROM position_pnl
      WHERE net_shares != 0
    `,
    format: 'JSONEachRow'
  });
  const pnl = await pnlResult.json<Array<any>>();

  console.log(`  Positions calculated: ${parseInt(pnl[0].total_positions).toLocaleString()}`);
  console.log(`  Total P&L: $${parseFloat(pnl[0].total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Total Profit: $${parseFloat(pnl[0].total_profit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Total Loss: $${parseFloat(pnl[0].total_loss).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`);

  // 4. Show top 5 winning and losing positions
  console.log('━━━ STEP 4: Top 5 Positions ━━━');
  const topPositionsResult = await clickhouse.query({
    query: `
      WITH trades_with_res AS (
        SELECT
          t.condition_id,
          lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
          t.outcome_index,
          t.trade_direction,
          toFloat64(t.shares) as shares,
          toFloat64(t.cashflow_usdc) as cashflow_usd,
          res.payout_numerators,
          res.payout_denominator,
          res.winning_index
        FROM default.trades_raw t
        INNER JOIN default.market_resolutions_final res
          ON lower(replaceAll(t.condition_id, '0x', '')) = res.condition_id_norm
        WHERE lower(t.wallet) = '${wallet}'
          AND length(replaceAll(t.condition_id, '0x', '')) = 64
      ),
      position_pnl AS (
        SELECT
          condition_id_norm,
          outcome_index,
          sum(if(trade_direction = 'BUY', shares, -shares)) as net_shares,
          sum(cashflow_usd) as net_cashflow_usd,
          any(payout_numerators) as payout_numerators,
          any(payout_denominator) as payout_denominator,
          any(winning_index) as winning_index,
          net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) + net_cashflow_usd as pnl
        FROM trades_with_res
        GROUP BY condition_id_norm, outcome_index
        HAVING net_shares != 0
      )
      SELECT
        condition_id_norm,
        outcome_index,
        net_shares,
        net_cashflow_usd,
        pnl
      FROM position_pnl
      ORDER BY pnl DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topPositions = await topPositionsResult.json<Array<any>>();

  console.log('\n  Top Positions:');
  topPositions.forEach((pos, i) => {
    console.log(`  ${i+1}. CID: ${pos.condition_id_norm.substring(0, 8)}... | Outcome: ${pos.outcome_index} | P&L: $${parseFloat(pos.pnl).toFixed(2)}`);
  });

  console.log('\n✅ P&L calculation complete!\n');
  console.log('📊 To compare with Polymarket UI:');
  console.log(`   Visit: https://polymarket.com/profile/${wallet}\n`);
}

main().catch(console.error);
