import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function debugMassiveCalculation() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🔍 DEBUGGING MASSIVE DATASET CALCULATION');
  console.log('='.repeat(60));

  // First, let's see what's in the data
  console.log('Step 1: Checking data types and sample trades...');

  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        timestamp,
        trade_direction,
        shares,
        entry_price,
        usd_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${wallet}')
      ORDER BY timestamp ASC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json();
  console.log('Sample trades:');
  samples.forEach((trade: any, i: number) => {
    console.log(`${i+1}. ${trade.trade_direction} | ${trade.shares} shares | $${trade.entry_price} | condition: ${trade.condition_id_norm?.slice(-8)}`);
  });

  // Check if we're getting proper numeric values
  console.log('\nStep 2: Checking numeric conversions...');

  const numericResult = await clickhouse.query({
    query: `
      SELECT
        trade_direction,
        count() as count,
        sum(toFloat64(shares)) as total_shares,
        avg(toFloat64(entry_price)) as avg_price,
        sum(toFloat64(usd_value)) as total_usd
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${wallet}')
        AND trade_direction IN ('BUY', 'SELL')
      GROUP BY trade_direction
      ORDER BY trade_direction
    `,
    format: 'JSONEachRow'
  });

  const numericData = await numericResult.json();
  console.log('Numeric analysis:');
  numericData.forEach((row: any) => {
    console.log(`${row.trade_direction}: ${row.count} trades, ${row.total_shares} shares, $${row.total_usd}`);
  });

  // Check market/outcome diversity
  console.log('\nStep 3: Market diversity check...');

  const marketResult = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        count() as trade_count,
        sum(toFloat64(shares)) as total_shares
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${wallet}')
        AND trade_direction IN ('BUY', 'SELL')
      GROUP BY condition_id_norm, outcome_index
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const marketData = await marketResult.json();
  console.log('Top markets by trade count:');
  marketData.forEach((market: any, i: number) => {
    console.log(`${i+1}. ${market.condition_id_norm.slice(-8)}_${market.outcome_index}: ${market.trade_count} trades, ${market.total_shares} shares`);
  });
}

debugMassiveCalculation().catch(console.error);