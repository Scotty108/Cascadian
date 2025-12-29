#!/usr/bin/env tsx
/**
 * Check Token Amount Signs
 *
 * The negative positions suggest that token_amount might already be signed!
 * BUY trades might have NEGATIVE token_amount values, which would break
 * our PnL calculations.
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

async function checkSigns() {
  console.log('━━━ TOKEN AMOUNT SIGN ANALYSIS ━━━\n');

  const signQuery = `
    SELECT
      side,
      count(*) as trade_count,
      countIf(token_amount > 0) as positive_amount,
      countIf(token_amount < 0) as negative_amount,
      countIf(token_amount = 0) as zero_amount,
      min(token_amount) as min_amount,
      max(token_amount) as max_amount,
      avg(token_amount) as avg_amount
    FROM pm_trader_events_v2
    GROUP BY side
  `;

  const signs = await clickhouse.query({
    query: signQuery,
    format: 'JSONEachRow'
  });
  const signsData = await signs.json<any[]>();

  console.log('Token amount signs by side:');
  console.table(signsData);

  // Also check USDC amount
  console.log('\n━━━ USDC AMOUNT SIGN ANALYSIS ━━━\n');

  const usdcSignQuery = `
    SELECT
      side,
      count(*) as trade_count,
      countIf(usdc_amount > 0) as positive_amount,
      countIf(usdc_amount < 0) as negative_amount,
      countIf(usdc_amount = 0) as zero_amount,
      min(usdc_amount) as min_amount,
      max(usdc_amount) as max_amount,
      avg(usdc_amount) as avg_amount
    FROM pm_trader_events_v2
    GROUP BY side
  `;

  const usdcSigns = await clickhouse.query({
    query: usdcSignQuery,
    format: 'JSONEachRow'
  });
  const usdcSignsData = await usdcSigns.json<any[]>();

  console.log('USDC amount signs by side:');
  console.table(usdcSignsData);

  // Sample some trades
  console.log('\n━━━ SAMPLE TRADES ━━━\n');

  const sampleQuery = `
    SELECT
      side,
      token_amount,
      usdc_amount,
      fee_amount,
      role
    FROM pm_trader_events_v2
    WHERE side = 'BUY'
    LIMIT 20
  `;

  const sample = await clickhouse.query({
    query: sampleQuery,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json<any[]>();

  console.log('Sample BUY trades:');
  console.table(sampleData);

  console.log('\n━━━ CONCLUSION ━━━\n');
  const buyData = signsData.find(row => row.side === 'BUY');
  if (buyData) {
    if (buyData.negative_amount > 0) {
      console.log('❌ CRITICAL BUG FOUND:');
      console.log(`   BUY trades have NEGATIVE token_amount values!`);
      console.log(`   ${buyData.negative_amount.toLocaleString()} out of ${buyData.trade_count.toLocaleString()} BUY trades are negative`);
      console.log(`\n   This explains the massive negative positions.`);
      console.log(`   The pm_trader_events_v2 table appears to have SIGNED values.`);
      console.log(`   DO NOT use: CASE WHEN side = 'BUY' THEN token_amount ELSE -token_amount END`);
      console.log(`   Instead, token_amount is ALREADY signed correctly!`);
    } else {
      console.log('✅ Token amounts look correct');
    }
  }
}

checkSigns()
  .then(() => {
    console.log('\n✅ Sign check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Sign check failed:', error);
    process.exit(1);
  });
