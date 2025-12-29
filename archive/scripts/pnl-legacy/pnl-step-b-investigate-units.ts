#!/usr/bin/env tsx

/**
 * Investigation: Unit Problem in PnL Calculation
 * 
 * Issue: PnL showing billions instead of thousands
 * Hypothesis: Shares or USDC amounts need division by 10^6 or 10^18
 */

import { clickhouse } from '../lib/clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const EGG_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const EGG_MARKET = 'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2';

async function main() {
  console.log('='.repeat(80));
  console.log('INVESTIGATING UNITS PROBLEM');
  console.log('='.repeat(80));
  console.log(`\nWallet: ${EGG_WALLET}`);
  console.log(`Market: ${EGG_MARKET} (Below $4.50 May)`);
  console.log(`Expected PnL: ~$41,289`);
  console.log(`Calculated PnL: $26B (clearly wrong!)\n`);

  // Check raw trade data
  console.log('SAMPLING RAW TRADE DATA:');
  console.log('─'.repeat(80));

  const rawTradesQuery = `
    SELECT
        t.side,
        t.usdc_amount,
        t.token_amount,
        t.price,
        m.outcome_index,
        m.question
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '${EGG_WALLET}'
      AND m.condition_id = '${EGG_MARKET}'
    ORDER BY t.timestamp
    LIMIT 10
  `;

  const rawResult = await clickhouse.query({
    query: rawTradesQuery,
    format: 'JSONEachRow'
  });

  const rawTrades: any[] = await rawResult.json();

  console.log('\nFirst 10 trades:');
  rawTrades.forEach((t, i) => {
    console.log(`\n${i + 1}. ${t.side.toUpperCase()}`);
    console.log(`   USDC: ${t.usdc_amount}`);
    console.log(`   Tokens: ${t.token_amount}`);
    console.log(`   Price: ${t.price}`);
    console.log(`   Outcome: ${t.outcome_index}`);
    console.log(`   Sanity Check: ${t.token_amount} * ${t.price} = ${t.token_amount * t.price} vs USDC ${t.usdc_amount}`);
  });

  // Check table schema
  console.log('\n' + '='.repeat(80));
  console.log('TABLE SCHEMA: pm_trader_events_v2');
  console.log('─'.repeat(80));

  const schemaQuery = `
    DESCRIBE TABLE pm_trader_events_v2
  `;

  const schemaResult = await clickhouse.query({
    query: schemaQuery,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaResult.json();

  schema.filter(s => 
    ['usdc_amount', 'token_amount', 'price'].includes(s.name)
  ).forEach(s => {
    console.log(`${s.name}: ${s.type}`);
  });

  // Get aggregates to see scale
  console.log('\n' + '='.repeat(80));
  console.log('AGGREGATE STATISTICS:');
  console.log('─'.repeat(80));

  const aggQuery = `
    SELECT
        count(*) as trade_count,
        sum(usdc_amount) as total_usdc,
        sum(token_amount) as total_tokens,
        avg(usdc_amount) as avg_usdc,
        avg(token_amount) as avg_tokens,
        min(usdc_amount) as min_usdc,
        max(usdc_amount) as max_usdc,
        min(token_amount) as min_tokens,
        max(token_amount) as max_tokens
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '${EGG_WALLET}'
      AND m.condition_id = '${EGG_MARKET}'
  `;

  const aggResult = await clickhouse.query({
    query: aggQuery,
    format: 'JSONEachRow'
  });

  const agg: any = (await aggResult.json())[0];

  console.log(`\nTrade Count: ${agg.trade_count}`);
  console.log(`Total USDC: ${agg.total_usdc}`);
  console.log(`Total Tokens: ${agg.total_tokens}`);
  console.log(`Avg USDC per trade: ${agg.avg_usdc}`);
  console.log(`Avg Tokens per trade: ${agg.avg_tokens}`);
  console.log(`Min/Max USDC: ${agg.min_usdc} / ${agg.max_usdc}`);
  console.log(`Min/Max Tokens: ${agg.min_tokens} / ${agg.max_tokens}`);

  // If avg USDC is > 1M, we likely need to divide by 1e6
  // If avg USDC is > 1B, we likely need to divide by 1e18

  console.log('\n' + '='.repeat(80));
  console.log('UNIT DIAGNOSIS:');
  console.log('─'.repeat(80));

  if (agg.avg_usdc > 1000000000) {
    console.log('⚠️  USDC amounts are in Wei units (need to divide by 1e18)');
  } else if (agg.avg_usdc > 1000000) {
    console.log('⚠️  USDC amounts are in micro-units (need to divide by 1e6)');
  } else if (agg.avg_usdc > 1000) {
    console.log('⚠️  USDC amounts are in milli-units (need to divide by 1e3)');
  } else {
    console.log('✓ USDC amounts appear to be in dollar units');
  }

  if (agg.avg_tokens > 1000000000) {
    console.log('⚠️  Token amounts are in Wei units (need to divide by 1e18)');
  } else if (agg.avg_tokens > 1000000) {
    console.log('⚠️  Token amounts are in micro-units (need to divide by 1e6)');
  } else if (agg.avg_tokens > 1000) {
    console.log('⚠️  Token amounts are in milli-units (need to divide by 1e3)');
  } else {
    console.log('✓ Token amounts appear to be in share units');
  }

  // Test corrected calculation
  console.log('\n' + '='.repeat(80));
  console.log('TESTING UNIT CORRECTIONS:');
  console.log('─'.repeat(80));

  const corrections = [
    { name: 'No correction', usdc_div: 1, token_div: 1 },
    { name: 'USDC ÷ 1e6', usdc_div: 1e6, token_div: 1 },
    { name: 'Tokens ÷ 1e6', usdc_div: 1, token_div: 1e6 },
    { name: 'Both ÷ 1e6', usdc_div: 1e6, token_div: 1e6 },
    { name: 'USDC ÷ 1e6, Tokens ÷ 1e18', usdc_div: 1e6, token_div: 1e18 },
  ];

  for (const corr of corrections) {
    const correctedQuery = `
      WITH per_outcome AS (
          SELECT
              m.outcome_index,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN -(t.usdc_amount / ${corr.usdc_div})
                       ELSE +(t.usdc_amount / ${corr.usdc_div}) END) as cash_delta,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN +(t.token_amount / ${corr.token_div})
                       ELSE -(t.token_amount / ${corr.token_div}) END) as final_shares
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          WHERE t.trader_wallet = '${EGG_WALLET}'
            AND m.condition_id = '${EGG_MARKET}'
          GROUP BY m.outcome_index
      ),
      with_resolution AS (
          SELECT
              p.*,
              CASE
                  WHEN r.condition_id IS NOT NULL AND r.payout_numerators != '' AND r.payout_numerators IS NOT NULL
                  THEN toFloat64OrZero(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', ''))[p.outcome_index + 1])
                  ELSE 0
              END as resolved_price
          FROM per_outcome p
          LEFT JOIN pm_condition_resolutions r ON r.condition_id = '${EGG_MARKET}'
      )
      SELECT
          sum(cash_delta) as total_cash,
          sum(final_shares * resolved_price) as total_value,
          sum(cash_delta) + sum(final_shares * resolved_price) as pnl
      FROM with_resolution
    `;

    const corrResult = await clickhouse.query({
      query: correctedQuery,
      format: 'JSONEachRow'
    });

    const corrData: any = (await corrResult.json())[0];

    console.log(`\n${corr.name}:`);
    console.log(`  PnL: $${corrData.pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Distance from expected ($41,289): $${Math.abs(corrData.pnl - 41289).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    if (Math.abs(corrData.pnl - 41289) < 100) {
      console.log('  ✅ MATCH! This is the correct unit conversion!');
    }
  }

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
