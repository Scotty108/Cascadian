#!/usr/bin/env tsx
/**
 * Diagnose Negative Positions
 *
 * These huge negative positions (-13B shares!) need investigation.
 * Let's see if they're in resolved markets and what trades created them.
 */

import * as dotenv from 'dotenv';
import { createClient } from '@clickhouse/client';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000
});

async function diagnose() {
  console.log('━━━ WORST NEGATIVE POSITION ANALYSIS ━━━\n');

  // Find the worst case
  const worstQuery = `
    SELECT
        t.trader_wallet,
        t.token_id,
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'BUY' THEN t.token_amount ELSE -t.token_amount END) as final_shares,
        count(*) as trade_count,
        min(t.trade_time) as first_trade,
        max(t.trade_time) as last_trade
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    GROUP BY t.trader_wallet, t.token_id, m.condition_id, m.outcome_index
    HAVING final_shares < -1000000
    ORDER BY final_shares ASC
    LIMIT 5
  `;

  const worst = await clickhouse.query({
    query: worstQuery,
    format: 'JSONEachRow'
  });
  const worstData = await worst.json<any[]>();

  console.log('Top 5 worst negative positions:');
  console.table(worstData.map(row => ({
    wallet: row.trader_wallet.substring(0, 12) + '...',
    condition_id: row.condition_id.substring(0, 16) + '...',
    outcome: row.outcome_index,
    shares: parseFloat(row.final_shares).toFixed(2),
    trades: row.trade_count,
    first: row.first_trade,
    last: row.last_trade
  })));

  // Check if worst case is resolved
  const worstCondition = worstData[0]?.condition_id;
  if (worstCondition) {
    console.log(`\n━━━ CHECKING RESOLUTION STATUS OF ${worstCondition.substring(0, 16)}... ━━━\n`);

    const resQuery = `
      SELECT *
      FROM pm_condition_resolutions
      WHERE condition_id = '${worstCondition}'
    `;

    const res = await clickhouse.query({
      query: resQuery,
      format: 'JSONEachRow'
    });
    const resData = await res.json<any[]>();

    if (resData.length > 0) {
      console.log('✅ This condition IS resolved:');
      console.table(resData);
    } else {
      console.log('❌ This condition is NOT resolved');
    }

    // Look at actual trades for this position
    console.log(`\n━━━ TRADES FOR WORST POSITION ━━━\n`);

    const tradesQuery = `
      SELECT
        t.side,
        t.token_amount,
        t.usdc_amount,
        t.fee_amount,
        t.trade_time,
        t.role
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE t.trader_wallet = '${worstData[0].trader_wallet}'
        AND m.condition_id = '${worstCondition}'
        AND m.outcome_index = ${worstData[0].outcome_index}
      ORDER BY t.trade_time ASC
      LIMIT 50
    `;

    const trades = await clickhouse.query({
      query: tradesQuery,
      format: 'JSONEachRow'
    });
    const tradesData = await trades.json<any[]>();

    console.log(`First 50 trades (of ${worstData[0].trade_count} total):`);
    console.table(tradesData.map((row, i) => ({
      num: i + 1,
      side: row.side,
      shares: parseFloat(row.token_amount).toFixed(2),
      usdc: parseFloat(row.usdc_amount).toFixed(2),
      fee: parseFloat(row.fee_amount).toFixed(2),
      role: row.role,
      time: row.trade_time
    })));

    // Running balance
    console.log(`\n━━━ RUNNING BALANCE ━━━\n`);
    let balance = 0;
    const balances = tradesData.slice(0, 20).map((row, i) => {
      const delta = row.side === 'BUY' ? parseFloat(row.token_amount) : -parseFloat(row.token_amount);
      balance += delta;
      return {
        num: i + 1,
        side: row.side,
        delta: delta.toFixed(2),
        balance: balance.toFixed(2),
        time: row.trade_time
      };
    });
    console.table(balances);
  }

  // Check fee distribution more carefully
  console.log('\n━━━ FEE ANALYSIS ━━━\n');

  const feeAnalysisQuery = `
    SELECT
      count(*) as total_trades,
      countIf(fee_amount = 0) as zero_fees,
      countIf(fee_amount > 0 AND fee_amount < 0.01) as tiny_fees,
      countIf(fee_amount >= 0.01) as normal_fees,
      min(fee_amount) as min_fee,
      max(fee_amount) as max_fee,
      avg(fee_amount) as avg_fee
    FROM pm_trader_events_v2
  `;

  const feeAnalysis = await clickhouse.query({
    query: feeAnalysisQuery,
    format: 'JSONEachRow'
  });
  const feeData = await feeAnalysis.json<any[]>();
  console.table(feeData);

  // Check if pm_trader_events_v2 might be missing data
  console.log('\n━━━ COMPARING pm_trader_events_v2 vs pm_fills ━━━\n');

  const countQuery = `
    SELECT
      (SELECT count(*) FROM pm_trader_events_v2) as trader_events_count,
      (SELECT count(*) FROM pm_fills) as fills_count
  `;

  const counts = await clickhouse.query({
    query: countQuery,
    format: 'JSONEachRow'
  });
  const countsData = await counts.json<any[]>();
  console.table(countsData);
}

diagnose()
  .then(() => {
    console.log('\n✅ Diagnosis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Diagnosis failed:', error);
    process.exit(1);
  });
