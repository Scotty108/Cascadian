#!/usr/bin/env npx tsx
/**
 * Explore Bitcoin markets to understand naming patterns
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function exploreBitcoinMarkets() {
  console.log('=== Exploring Bitcoin Markets ===\n');

  // Find all Bitcoin-related markets
  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        volume_usdc,
        is_active,
        is_closed
      FROM (
        SELECT
          condition_id,
          any(question) as question,
          any(volume_usdc) as volume_usdc,
          any(is_active) as is_active,
          any(is_closed) as is_closed
        FROM pm_market_metadata
        GROUP BY condition_id
      )
      WHERE question ILIKE '%bitcoin%'
         OR question ILIKE '%btc%'
      ORDER BY volume_usdc DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const markets = (await result.json()) as any[];

  console.log(`Found ${markets.length} Bitcoin markets\n`);
  console.log('Sample questions:\n');

  markets.forEach((m, i) => {
    const status = m.is_active ? '🟢' : (m.is_closed ? '🔴' : '⚪');
    console.log(`${i + 1}. ${status} ${m.question}`);
    console.log(`   Volume: $${m.volume_usdc?.toLocaleString() || 0} | ID: ${m.condition_id.slice(0, 16)}...`);
    console.log();
  });

  // Check for time-based patterns
  console.log('\n=== Time-based Bitcoin markets ===\n');

  const timeBasedResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question
      FROM (
        SELECT
          condition_id,
          any(question) as question
        FROM pm_market_metadata
        GROUP BY condition_id
      )
      WHERE (question ILIKE '%bitcoin%'
         OR question ILIKE '%btc%')
        AND (question ILIKE '%minute%'
         OR question ILIKE '%min%'
         OR question ILIKE '%hour%'
         OR question ILIKE '%hourly%')
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const timeMarkets = (await timeBasedResult.json()) as any[];

  console.log(`Found ${timeMarkets.length} time-based Bitcoin markets:\n`);
  timeMarkets.forEach((m, i) => {
    console.log(`${i + 1}. ${m.question}`);
  });
}

exploreBitcoinMarkets().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
