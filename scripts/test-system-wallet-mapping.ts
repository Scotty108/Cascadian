#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  console.log('🔍 Testing System Wallet Mapping Discovery\n');
  console.log(`UI Wallet:     ${UI_WALLET}`);
  console.log(`System Wallet: ${SYSTEM_WALLET}\n`);

  // 1. Check if mapping exists
  console.log('━━━ STEP 1: Verify Mapping Exists ━━━\n');
  const mappingResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_mappings,
        uniqExact(cid_hex) as unique_markets
      FROM cascadian_clean.system_wallet_map
      WHERE user_wallet = '${UI_WALLET}'
        AND system_wallet = '${SYSTEM_WALLET}'
    `,
    format: 'JSONEachRow'
  });
  const mapping = await mappingResult.json<Array<any>>();
  console.log(`Mappings found: ${parseInt(mapping[0].total_mappings).toLocaleString()}`);
  console.log(`Unique markets: ${parseInt(mapping[0].unique_markets).toLocaleString()}\n`);

  // 2. Compare trade counts
  console.log('━━━ STEP 2: Compare Trade Counts ━━━\n');

  const uiTradesResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM default.trades_raw WHERE lower(wallet) = '${UI_WALLET.toLowerCase()}'`,
    format: 'JSONEachRow'
  });
  const uiTrades = await uiTradesResult.json<Array<any>>();

  const systemTradesResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM default.trades_raw WHERE lower(wallet) = '${SYSTEM_WALLET.toLowerCase()}'`,
    format: 'JSONEachRow'
  });
  const systemTrades = await systemTradesResult.json<Array<any>>();

  console.log(`UI Wallet trades:     ${parseInt(uiTrades[0].cnt).toLocaleString()}`);
  console.log(`System Wallet trades: ${parseInt(systemTrades[0].cnt).toLocaleString()}\n`);

  // 3. Search for egg market in system wallet
  console.log('━━━ STEP 3: Search for Egg Market ━━━\n');

  // First find the egg market
  const eggMarketResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        volume,
        closed
      FROM default.gamma_markets
      WHERE question LIKE '%egg%'
        AND question LIKE '%May%'
        AND question LIKE '%4.50%'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const eggMarkets = await eggMarketResult.json<Array<any>>();

  if (eggMarkets.length > 0) {
    console.log('✅ Found egg markets in gamma_markets:\n');
    eggMarkets.forEach((m, i) => {
      console.log(`${i+1}. ${m.question}`);
      console.log(`   Condition ID: ${m.condition_id}`);
      console.log(`   Volume: $${parseFloat(m.volume).toLocaleString()}`);
      console.log(`   Closed: ${m.closed === 1 ? 'Yes' : 'No'}\n`);
    });

    // Check if system wallet traded this market
    const eggCid = eggMarkets[0].condition_id;
    const eggTradesResult = await clickhouse.query({
      query: `
        SELECT
          count() as trade_count,
          sum(toFloat64(shares)) as total_shares,
          sum(toFloat64(cashflow_usdc)) as total_cashflow
        FROM default.trades_raw
        WHERE lower(wallet) = '${SYSTEM_WALLET.toLowerCase()}'
          AND condition_id = '${eggCid}'
      `,
      format: 'JSONEachRow'
    });
    const eggTrades = await eggTradesResult.json<Array<any>>();

    console.log('━━━ System Wallet Trades in This Market ━━━\n');
    console.log(`Trades: ${parseInt(eggTrades[0].trade_count)}`);
    console.log(`Total shares: ${parseFloat(eggTrades[0].total_shares).toFixed(2)}`);
    console.log(`Total cashflow: $${parseFloat(eggTrades[0].total_cashflow).toFixed(2)}\n`);

  } else {
    console.log('❌ No egg markets found in gamma_markets\n');
  }

  // 4. Get P&L for system wallet
  console.log('━━━ STEP 4: Calculate P&L (System Wallet) ━━━\n');

  const pnlResult = await clickhouse.query({
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
        WHERE lower(t.wallet) = '${SYSTEM_WALLET.toLowerCase()}'
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

  console.log(`Positions: ${parseInt(pnl[0].total_positions).toLocaleString()}`);
  console.log(`Total P&L: $${parseFloat(pnl[0].total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`Profit: $${parseFloat(pnl[0].total_profit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`Loss: $${parseFloat(pnl[0].total_loss).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`);

  console.log('━━━ COMPARISON ━━━\n');
  console.log(`Polymarket UI P&L:  $95,373.13`);
  console.log(`Our Calculated P&L: $${parseFloat(pnl[0].total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`Difference:         $${(95373.13 - parseFloat(pnl[0].total_pnl)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`);
}

main().catch(console.error);
