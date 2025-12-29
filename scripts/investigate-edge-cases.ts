#!/usr/bin/env tsx
/**
 * Investigate Edge Cases Detected
 *
 * Following up on edge case detection findings:
 * 1. 30M+ negative positions in resolved markets
 * 2. 100% of trades have zero fees (seems wrong)
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

async function investigate() {
  console.log('━━━ INVESTIGATING NEGATIVE POSITIONS ━━━\n');

  // Sample some negative positions
  const negSampleQuery = `
    WITH positions AS (
        SELECT
            t.trader_wallet,
            m.condition_id,
            m.outcome_index,
            sum(CASE WHEN t.side = 'BUY' THEN t.token_amount ELSE -t.token_amount END) as final_shares,
            count(*) as trade_count
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
        GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
    )
    SELECT
        trader_wallet,
        condition_id,
        outcome_index,
        final_shares,
        trade_count
    FROM positions
    WHERE final_shares < -0.01
    ORDER BY final_shares ASC
    LIMIT 10
  `;

  const negSample = await clickhouse.query({
    query: negSampleQuery,
    format: 'JSONEachRow'
  });
  const negData = await negSample.json<any[]>();

  console.log('Sample negative positions (worst 10):');
  console.table(negData.map(row => ({
    wallet: row.trader_wallet.substring(0, 10) + '...',
    condition_id: row.condition_id.substring(0, 16) + '...',
    outcome: row.outcome_index,
    shares: parseFloat(row.final_shares).toFixed(6),
    trades: row.trade_count
  })));

  console.log('\n━━━ INVESTIGATING FEE STRUCTURE ━━━\n');

  // Check fee_amount column
  const feeCheckQuery = `
    SELECT
      'fee_amount column' as check_type,
      min(fee_amount) as min_fee,
      max(fee_amount) as max_fee,
      avg(fee_amount) as avg_fee,
      countIf(fee_amount > 0) as non_zero_count
    FROM pm_trader_events_v2
    LIMIT 1
  `;

  const feeCheck = await clickhouse.query({
    query: feeCheckQuery,
    format: 'JSONEachRow'
  });
  const feeData = await feeCheck.json<any[]>();

  console.log('Fee Amount Statistics:');
  console.table(feeData);

  // Check if there are other fee columns
  const describeQuery = `DESCRIBE TABLE pm_trader_events_v2`;
  const describe = await clickhouse.query({
    query: describeQuery,
    format: 'JSONEachRow'
  });
  const schema = await describe.json<any[]>();

  console.log('\n━━━ SCHEMA - LOOKING FOR FEE COLUMNS ━━━\n');
  const feeColumns = schema.filter(col =>
    col.name.toLowerCase().includes('fee') ||
    col.name.toLowerCase().includes('cost') ||
    col.name.toLowerCase().includes('price')
  );
  console.table(feeColumns);

  // Sample some trades to see actual data
  const tradesSampleQuery = `
    SELECT
      trader_wallet,
      side,
      token_amount,
      usdc_amount,
      fee_amount,
      timestamp
    FROM pm_trader_events_v2
    LIMIT 20
  `;

  const tradesSample = await clickhouse.query({
    query: tradesSampleQuery,
    format: 'JSONEachRow'
  });
  const tradesData = await tradesSample.json<any[]>();

  console.log('\n━━━ SAMPLE TRADES ━━━\n');
  console.table(tradesData.map(row => ({
    wallet: row.trader_wallet.substring(0, 12) + '...',
    side: row.side,
    shares: parseFloat(row.token_amount).toFixed(4),
    usdc: parseFloat(row.usdc_amount).toFixed(4),
    fee: parseFloat(row.fee_amount).toFixed(4),
    timestamp: row.timestamp
  })));

  // Check pm_fills for fee data
  console.log('\n━━━ CHECKING pm_fills FOR FEE DATA ━━━\n');

  const fillsSchemaQuery = `DESCRIBE TABLE pm_fills`;
  const fillsSchema = await clickhouse.query({
    query: fillsSchemaQuery,
    format: 'JSONEachRow'
  });
  const fillsSchemaData = await fillsSchema.json<any[]>();

  const fillsFeeColumns = fillsSchemaData.filter(col =>
    col.name.toLowerCase().includes('fee') ||
    col.name.toLowerCase().includes('cost')
  );
  console.log('Fee-related columns in pm_fills:');
  console.table(fillsFeeColumns);

  // Sample pm_fills
  const fillsSampleQuery = `
    SELECT
      trader,
      side,
      shares_amount,
      usdc_amount,
      fee_rate_bps,
      timestamp
    FROM pm_fills
    LIMIT 20
  `;

  const fillsSample = await clickhouse.query({
    query: fillsSampleQuery,
    format: 'JSONEachRow'
  });
  const fillsData = await fillsSample.json<any[]>();

  console.log('\nSample fills:');
  console.table(fillsData.map(row => ({
    trader: row.trader.substring(0, 12) + '...',
    side: row.side,
    shares: parseFloat(row.shares_amount).toFixed(4),
    usdc: parseFloat(row.usdc_amount).toFixed(4),
    fee_bps: row.fee_rate_bps,
    timestamp: row.timestamp
  })));
}

investigate()
  .then(() => {
    console.log('\n✅ Investigation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Investigation failed:', error);
    process.exit(1);
  });
