#!/usr/bin/env npx tsx
/**
 * INVESTIGATION: Token ID Decoding and Resolution Matching
 * 
 * Mission: Fix P&L calculation for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 * 
 * Problem: 10 redemption burns but ZERO resolution matches
 * Root Cause: Wrong token_id → condition_id decoding
 * 
 * Correct Formula (ERC-1155 CTF encoding):
 *   condition_id = token_id >> 8  (divide by 256)
 *   outcome_index = token_id & 255 (last byte)
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
  console.log('TOKEN ID DECODING INVESTIGATION');
  console.log('═'.repeat(80));
  console.log();
  console.log(`Wallet: ${WALLET}`);
  console.log();

  // ============================================================================
  // STEP 1: Get burned tokens (redemptions)
  // ============================================================================
  
  console.log('STEP 1: Find Redemption Burns');
  console.log('─'.repeat(80));
  console.log();

  const burnsQuery = await client.query({
    query: `
      SELECT
        token_id,
        sum(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) as redeemed_shares
      FROM erc1155_transfers
      WHERE from_address = '${WALLET}'
        AND to_address = '0x0000000000000000000000000000000000000000'
      GROUP BY token_id
      ORDER BY redeemed_shares DESC
    `,
    format: 'JSONEachRow',
  });

  const burns = await burnsQuery.json<Array<{
    token_id: string;
    redeemed_shares: string;
  }>>();

  console.log(`Found ${burns.length} burned tokens (redemptions)`);
  console.log();
  console.log('Sample burns:');
  burns.slice(0, 3).forEach((b, i) => {
    console.log(`  ${i + 1}. token_id: ${b.token_id}`);
    console.log(`     shares:   ${b.redeemed_shares}`);
  });
  console.log();

  // ============================================================================
  // STEP 2: Decode using CORRECT formula
  // ============================================================================
  
  console.log('STEP 2: Decode Token IDs (Correct ERC-1155 Formula)');
  console.log('─'.repeat(80));
  console.log();
  console.log('Formula:');
  console.log('  condition_id = token_id >> 8  (divide by 256)');
  console.log('  outcome_index = token_id & 255 (last byte)');
  console.log();

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

  console.log(`Decoded ${decoded.length} tokens:`);
  console.log();
  decoded.slice(0, 5).forEach((d, i) => {
    console.log(`  ${i + 1}. token_id:       ${d.token_id}`);
    console.log(`     condition_id:    ${d.condition_id}`);
    console.log(`     outcome_index:   ${d.outcome_index}`);
    console.log();
  });

  // ============================================================================
  // STEP 3: Check resolution coverage
  // ============================================================================
  
  console.log('STEP 3: Check Resolution Data');
  console.log('─'.repeat(80));
  console.log();

  const conditionIds = decoded.map(d => `'${d.condition_id}'`).join(',');

  const resolutionQuery = await client.query({
    query: `
      SELECT
        lower(replaceOne(condition_id_norm, '0x', '')) as condition_id_norm,
        winning_index,
        resolved_at
      FROM market_resolutions_final
      WHERE lower(replaceOne(condition_id_norm, '0x', '')) IN (${conditionIds})
    `,
    format: 'JSONEachRow',
  });

  const resolutions = await resolutionQuery.json<Array<{
    condition_id_norm: string;
    winning_index: number;
    resolved_at: string;
  }>>();

  console.log(`Found ${resolutions.length} resolutions out of ${decoded.length} burned tokens`);
  console.log(`Coverage: ${((resolutions.length / decoded.length) * 100).toFixed(1)}%`);
  console.log();

  if (resolutions.length > 0) {
    console.log('Sample resolutions:');
    resolutions.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i + 1}. condition_id:  ${r.condition_id_norm}`);
      console.log(`     winning_index:  ${r.winning_index}`);
      console.log(`     resolved_at:    ${r.resolved_at}`);
      console.log();
    });
  } else {
    console.log('⚠️  NO RESOLUTIONS FOUND');
    console.log();
    console.log('Investigating alternative resolution tables...');
    console.log();

    // Check gamma_markets
    const gammaQuery = await client.query({
      query: `
        SELECT
          lower(replaceOne(condition_id, '0x', '')) as condition_id,
          outcomePrices,
          resolved
        FROM gamma_markets
        WHERE lower(replaceOne(condition_id, '0x', '')) IN (${conditionIds})
          AND resolved = true
      `,
      format: 'JSONEachRow',
    });

    const gammaResolutions = await gammaQuery.json<any[]>();
    console.log(`Found ${gammaResolutions.length} resolutions in gamma_markets`);

    if (gammaResolutions.length > 0) {
      console.log();
      console.log('Sample from gamma_markets:');
      gammaResolutions.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i + 1}. condition_id:  ${r.condition_id}`);
        console.log(`     resolved:       ${r.resolved}`);
        console.log(`     outcomePrices:  ${r.outcomePrices}`);
        console.log();
      });
    }
  }

  // ============================================================================
  // STEP 4: Calculate P&L with correct decoding
  // ============================================================================
  
  console.log('STEP 4: Calculate P&L (Correct Formula)');
  console.log('─'.repeat(80));
  console.log();

  const pnlQuery = await client.query({
    query: `
      WITH
      -- Get all burns (redemptions) for this wallet
      burns AS (
        SELECT
          token_id,
          sum(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) as redeemed_shares
        FROM erc1155_transfers
        WHERE from_address = '${WALLET}'
          AND to_address = '0x0000000000000000000000000000000000000000'
        GROUP BY token_id
      ),
      -- Decode token_id to condition_id + outcome_index
      decoded AS (
        SELECT
          b.token_id,
          b.redeemed_shares,
          lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))), 8))) as condition_id,
          toUInt8(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(b.token_id, 3)))), 255)) as outcome_index
        FROM burns b
      ),
      -- Join with resolutions
      with_resolutions AS (
        SELECT
          d.*,
          r.winning_index,
          if(d.outcome_index = r.winning_index, d.redeemed_shares, 0) as payout_usdc
        FROM decoded d
        LEFT JOIN (
          SELECT
            lower(replaceOne(condition_id_norm, '0x', '')) as condition_id_norm,
            winning_index
          FROM market_resolutions_final
        ) r ON d.condition_id = r.condition_id_norm
      )
      SELECT
        count() as total_redeemed_positions,
        countIf(winning_index IS NOT NULL) as positions_with_resolution,
        sum(redeemed_shares) as total_shares_redeemed,
        sum(payout_usdc) as total_payout_usdc
      FROM with_resolutions
    `,
    format: 'JSONEachRow',
  });

  const pnl = await pnlQuery.json<Array<{
    total_redeemed_positions: number;
    positions_with_resolution: number;
    total_shares_redeemed: string;
    total_payout_usdc: string;
  }>>();

  console.log('P&L Summary:');
  console.log(`  Total redeemed positions:    ${pnl[0].total_redeemed_positions}`);
  console.log(`  Positions with resolution:   ${pnl[0].positions_with_resolution}`);
  console.log(`  Total shares redeemed:       ${pnl[0].total_shares_redeemed}`);
  console.log(`  Total payout (USDC):         $${pnl[0].total_payout_usdc}`);
  console.log();

  // ============================================================================
  // STEP 5: Show the WRONG vs CORRECT decoding
  // ============================================================================
  
  console.log('STEP 5: Compare Wrong vs Correct Decoding');
  console.log('─'.repeat(80));
  console.log();

  const sampleToken = burns[0].token_id;
  
  console.log(`Sample token_id: ${sampleToken}`);
  console.log();
  console.log('WRONG method (treating as hex string):');
  console.log('  Last 2 chars = outcome');
  console.log('  First 62 + "00" = condition_id');
  console.log(`  Would give: condition_id = ${sampleToken.slice(0, -2)}00`);
  console.log(`              outcome = 0x${sampleToken.slice(-2)}`);
  console.log();
  console.log('CORRECT method (ERC-1155 integer encoding):');
  console.log('  condition_id = token_id >> 8');
  console.log('  outcome_index = token_id & 255');
  
  const correctDecodeQuery = await client.query({
    query: `
      SELECT
        lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring('${sampleToken}', 3)))), 8))) as condition_id,
        toUInt8(bitAnd(reinterpretAsUInt256(reverse(unhex(substring('${sampleToken}', 3)))), 255)) as outcome_index
    `,
    format: 'JSONEachRow',
  });
  
  const correctDecode = await correctDecodeQuery.json<any[]>();
  console.log(`  Gives: condition_id = ${correctDecode[0].condition_id}`);
  console.log(`         outcome_index = ${correctDecode[0].outcome_index}`);
  console.log();

  // ============================================================================
  // FINAL RECOMMENDATIONS
  // ============================================================================
  
  console.log('═'.repeat(80));
  console.log('FINAL RECOMMENDATIONS');
  console.log('═'.repeat(80));
  console.log();

  if (resolutions.length === 0) {
    console.log('❌ CRITICAL ISSUE: Zero resolutions found even with correct decoding');
    console.log();
    console.log('This means:');
    console.log('  1. Token decoding is now FIXED');
    console.log('  2. BUT market_resolutions_final is INCOMPLETE');
    console.log();
    console.log('Action items:');
    console.log('  1. Check if these markets are in gamma_markets table');
    console.log('  2. Backfill missing resolutions from Polymarket API');
    console.log('  3. Or use alternative resolution source (gamma_markets, clob API)');
    console.log();
  } else if (resolutions.length < decoded.length) {
    console.log(`⚠️  PARTIAL COVERAGE: ${resolutions.length}/${decoded.length} resolutions found`);
    console.log();
    console.log(`Missing: ${decoded.length - resolutions.length} resolutions`);
    console.log();
    console.log('Action items:');
    console.log('  1. Backfill missing resolutions');
    console.log('  2. Check if missing markets are unresolved or data gap');
    console.log();
  } else {
    console.log('✅ FULL COVERAGE: All burned tokens have resolutions');
    console.log();
    console.log('P&L calculation should now be accurate!');
    console.log();
  }

  console.log('Correct SQL query for P&L:');
  console.log('─'.repeat(80));
  console.log(`
WITH 
-- Get all burns (redemptions) for wallet
burns AS (
  SELECT 
    token_id,
    sum(value) as redeemed_shares
  FROM erc1155_transfers
  WHERE from_address = '${WALLET}'
    AND to_address = '0x0000000000000000000000000000000000000000'
  GROUP BY token_id
),
-- Decode using CORRECT formula
decoded AS (
  SELECT
    b.token_id,
    b.redeemed_shares,
    lower(hex(bitShiftRight(toUInt256(b.token_id), 8))) as condition_id,
    toUInt8(bitAnd(toUInt256(b.token_id), 255)) as outcome_index
  FROM burns b
),
-- Join with resolutions
with_resolutions AS (
  SELECT
    d.token_id,
    d.condition_id,
    d.outcome_index,
    d.redeemed_shares,
    r.winning_index,
    if(d.outcome_index = r.winning_index, d.redeemed_shares, 0) as payout_usdc
  FROM decoded d
  LEFT JOIN (
    SELECT 
      lower(replaceOne(condition_id_norm, '0x', '')) as condition_id_norm,
      winning_index
    FROM market_resolutions_final
  ) r ON d.condition_id = r.condition_id_norm
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
  
  await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
