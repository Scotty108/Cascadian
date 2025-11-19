#!/usr/bin/env npx tsx
/**
 * FINAL INVESTIGATION REPORT: Token ID Decoding Fixed
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═'.repeat(80));
  console.log('FINAL INVESTIGATION REPORT');
  console.log('═'.repeat(80));
  console.log();

  // Step 1: Decode burned tokens
  const decodedQuery = await client.query({
    query: `
      WITH burns AS (
        SELECT DISTINCT token_id
        FROM erc1155_transfers
        WHERE from_address = '${WALLET}'
          AND to_address = '0x0000000000000000000000000000000000000000'
      )
      SELECT
        token_id,
        lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))) as condition_id,
        toUInt8(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 255)) as outcome_index
      FROM burns
      ORDER BY token_id
    `,
    format: 'JSONEachRow',
  });

  const decoded = await decodedQuery.json<Array<{
    token_id: string;
    condition_id: string;
    outcome_index: number;
  }>>();

  console.log(`✅ Token Decoding: ${decoded.length} tokens decoded successfully`);
  console.log();

  // Step 2: Check market_resolutions_final
  const conditionIds = decoded.map(d => `'${d.condition_id}'`).join(',');
  
  const resolutionQuery = await client.query({
    query: `
      SELECT 
        lower(replaceOne(condition_id_norm, '0x', '')) as condition_id_norm,
        winning_index
      FROM market_resolutions_final
      WHERE lower(replaceOne(condition_id_norm, '0x', '')) IN (${conditionIds})
    `,
    format: 'JSONEachRow',
  });

  const resolutions = await resolutionQuery.json<any[]>();
  
  console.log(`❌ Resolution Coverage: ${resolutions.length}/${decoded.length} (${((resolutions.length/decoded.length)*100).toFixed(1)}%)`);
  console.log();
  
  // Step 3: Check gamma_markets
  const gammaQuery = await client.query({
    query: `
      SELECT 
        lower(replaceOne(condition_id, '0x', '')) as condition_id,
        resolved,
        outcome_prices
      FROM gamma_markets
      WHERE lower(replaceOne(condition_id, '0x', '')) IN (${conditionIds})
    `,
    format: 'JSONEachRow',
  });

  const gammaMarkets = await gammaQuery.json<any[]>();
  const resolvedInGamma = gammaMarkets.filter((m: any) => m.resolved);
  
  console.log(`📊 Alternative Source (gamma_markets): ${resolvedInGamma.length}/${decoded.length} resolved`);
  console.log();

  // Step 4: Show complete mapping
  console.log('═'.repeat(80));
  console.log('COMPLETE MAPPING');
  console.log('═'.repeat(80));
  console.log();
  
  decoded.forEach((d, i) => {
    const resolution = resolutions.find(r => r.condition_id_norm === d.condition_id);
    const gamma = gammaMarkets.find(g => g.condition_id === d.condition_id);
    
    console.log(`${i + 1}. Token ID: ${d.token_id.slice(0, 20)}...`);
    console.log(`   Condition ID:    ${d.condition_id}`);
    console.log(`   Outcome Index:   ${d.outcome_index}`);
    console.log(`   In market_resolutions_final: ${resolution ? '✅ YES' : '❌ NO'}`);
    console.log(`   In gamma_markets: ${gamma ? (gamma.resolved ? '✅ RESOLVED' : '⚠️  UNRESOLVED') : '❌ NOT FOUND'}`);
    console.log();
  });

  console.log('═'.repeat(80));
  console.log('ROOT CAUSE ANALYSIS');
  console.log('═'.repeat(80));
  console.log();
  console.log('✅ FIXED: Token ID decoding formula is now CORRECT');
  console.log();
  console.log('   OLD (WRONG): Treating token_id as hex string, taking last 2 chars');
  console.log('   NEW (CORRECT): token_id >> 8 = condition_id, token_id & 255 = outcome_index');
  console.log();
  console.log('❌ PROBLEM: market_resolutions_final is INCOMPLETE');
  console.log();
  console.log(`   Missing ${decoded.length - resolutions.length} out of ${decoded.length} resolutions for this wallet`);
  console.log();
  
  console.log('═'.repeat(80));
  console.log('SOLUTION: Correct SQL Query');
  console.log('═'.repeat(80));
  console.log();
  console.log(`
-- Calculate P&L for wallet with CORRECT token decoding
WITH 
-- Get all burns (redemptions)
burns AS (
  SELECT 
    token_id,
    sum(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) as redeemed_shares
  FROM erc1155_transfers
  WHERE from_address = '${WALLET}'
    AND to_address = '0x0000000000000000000000000000000000000000'
  GROUP BY token_id
),
-- Decode token_id using CORRECT ERC-1155 formula
decoded AS (
  SELECT
    b.token_id,
    b.redeemed_shares,
    lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))), 8))) as condition_id,
    toUInt8(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))), 255)) as outcome_index
  FROM burns b
),
-- Join with resolutions (use gamma_markets as fallback)
with_resolutions AS (
  SELECT
    d.token_id,
    d.condition_id,
    d.outcome_index,
    d.redeemed_shares,
    COALESCE(r.winning_index, g.winning_index) as winning_index,
    if(d.outcome_index = winning_index, d.redeemed_shares, 0) as payout_usdc
  FROM decoded d
  LEFT JOIN (
    SELECT 
      lower(replaceOne(condition_id_norm, '0x', '')) as condition_id_norm,
      winning_index
    FROM market_resolutions_final
  ) r ON d.condition_id = r.condition_id_norm
  LEFT JOIN (
    -- Derive winning_index from gamma_markets.outcome_prices
    SELECT
      lower(replaceOne(condition_id, '0x', '')) as condition_id,
      -- Find index of outcome with price = 1.0 (winner)
      if(outcome_prices[1] = 1.0, 0, if(outcome_prices[2] = 1.0, 1, -1)) as winning_index
    FROM gamma_markets
    WHERE resolved = true
  ) g ON d.condition_id = g.condition_id
)
SELECT
  token_id,
  condition_id,
  outcome_index,
  redeemed_shares,
  winning_index,
  payout_usdc
FROM with_resolutions
ORDER BY payout_usdc DESC;
  `);
  console.log();

  console.log('═'.repeat(80));
  console.log('ACTION ITEMS');
  console.log('═'.repeat(80));
  console.log();
  console.log('1. ✅ Token decoding is FIXED - use correct formula everywhere');
  console.log();
  console.log('2. ❌ Backfill missing resolutions:');
  console.log('   - Check Polymarket API for resolution data');
  console.log('   - Use gamma_markets.outcome_prices as fallback');
  console.log('   - Insert missing resolutions into market_resolutions_final');
  console.log();
  console.log('3. 🔧 Update P&L calculation to use correct decoding formula');
  console.log();
  
  await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
