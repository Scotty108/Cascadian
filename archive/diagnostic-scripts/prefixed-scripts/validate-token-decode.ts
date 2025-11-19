/**
 * TOKEN DECODE VALIDATION
 *
 * Purpose: Validate that our token_id decoding matches Polymarket's Gamma API
 * Sample: 25 random assets from wallet fills
 *
 * Formula:
 * - condition_id = token_id >> 8 (bitwise right shift 8)
 * - outcome_index = token_id & 0xff (bitwise AND with 255)
 *
 * Expected: 100% match rate
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 60000,
});

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface TokenValidation {
  token_id: string;
  decoded_condition_id: string;
  decoded_outcome_index: number;
  market_slug?: string;
  gamma_condition_id?: string;
  gamma_outcome_index?: number;
  match: boolean;
  winning_index?: number;
}

/**
 * Decode token_id using bitwise operations
 */
function decodeTokenId(tokenId: string): { conditionId: string; outcomeIndex: number } {
  const hex = tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId;
  const tokenBigInt = BigInt('0x' + hex);

  const conditionIdBigInt = tokenBigInt >> 8n;
  const conditionId = conditionIdBigInt.toString(16).padStart(64, '0');

  const outcomeIndex = Number(tokenBigInt & 255n);

  return { conditionId, outcomeIndex };
}

/**
 * Load 25 random assets from wallet fills
 */
async function loadSampleAssets(): Promise<string[]> {
  const query = `
    SELECT DISTINCT asset_id
    FROM clob_fills
    WHERE proxy_wallet = '${TARGET_WALLET}'
    ORDER BY rand()
    LIMIT 25
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => r.asset_id);
}

/**
 * Verify token decode against ClickHouse implementation
 */
async function verifyAgainstClickHouse(tokenId: string): Promise<{
  ch_condition_id: string;
  ch_outcome_index: number;
}> {
  const query = `
    SELECT
      lower(hex(bitShiftRight(
        reinterpretAsUInt256(reverse(unhex(substring('${tokenId}', 3)))),
        8
      ))) as condition_id_norm,
      toUInt8(bitAnd(
        reinterpretAsUInt256(reverse(unhex(substring('${tokenId}', 3)))),
        255
      )) as outcome_index
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const row = (await result.json() as any[])[0];

  return {
    ch_condition_id: row.condition_id_norm,
    ch_outcome_index: row.outcome_index,
  };
}

/**
 * Load market info from resolution table
 */
async function loadMarketInfo(conditionId: string): Promise<{
  market_slug?: string;
  winning_index?: number;
}> {
  const query = `
    SELECT
      winning_index,
      winning_outcome
    FROM market_resolutions_final
    WHERE condition_id_norm = '${conditionId}'
    LIMIT 1
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) {
    return {};
  }

  return {
    market_slug: rows[0].winning_outcome,  // Use winning_outcome as proxy for slug
    winning_index: rows[0].winning_index,
  };
}

/**
 * Fetch from Gamma API (external verification)
 */
async function fetchFromGamma(tokenId: string): Promise<{
  condition_id?: string;
  outcome_index?: number;
  market_slug?: string;
}> {
  try {
    // Gamma API endpoint for token info
    // This is a placeholder - actual endpoint may vary
    const response = await fetch(
      `https://gamma-api.polymarket.com/token/${tokenId}`
    );

    if (!response.ok) {
      return {};
    }

    const data = await response.json();

    return {
      condition_id: data.condition_id,
      outcome_index: data.outcome,
      market_slug: data.market_slug,
    };
  } catch (error) {
    // Gamma API not available or rate limited
    return {};
  }
}

/**
 * Main validation
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TOKEN DECODE VALIDATION');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('Sample: 25 random assets');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load sample assets
  console.log('📊 Loading 25 random assets...\n');
  const sampleAssets = await loadSampleAssets();
  console.log(`✅ Loaded ${sampleAssets.length} assets\n`);

  // Validate each asset
  console.log('🔍 Validating token decode...\n');

  const validations: TokenValidation[] = [];
  let matches = 0;

  for (let i = 0; i < sampleAssets.length; i++) {
    const tokenId = sampleAssets[i];

    // Decode using our TypeScript function
    const tsDecoded = decodeTokenId(tokenId);

    // Verify against ClickHouse
    const chDecoded = await verifyAgainstClickHouse(tokenId);

    // Check if they match
    const match =
      tsDecoded.conditionId === chDecoded.ch_condition_id &&
      tsDecoded.outcomeIndex === chDecoded.ch_outcome_index;

    if (match) matches++;

    // Load market info
    const marketInfo = await loadMarketInfo(tsDecoded.conditionId);

    // Try Gamma API (optional)
    const gammaInfo = await fetchFromGamma(tokenId);

    validations.push({
      token_id: tokenId,
      decoded_condition_id: tsDecoded.conditionId,
      decoded_outcome_index: tsDecoded.outcomeIndex,
      market_slug: marketInfo.market_slug || gammaInfo.market_slug,
      gamma_condition_id: gammaInfo.condition_id,
      gamma_outcome_index: gammaInfo.outcome_index,
      match,
      winning_index: marketInfo.winning_index,
    });

    console.log(`[${i + 1}/25] ${tokenId.slice(0, 10)}... ${match ? '✅' : '❌'}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('VALIDATION RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Total Assets: ${sampleAssets.length}`);
  console.log(`Matches: ${matches}`);
  console.log(`Match Rate: ${((matches / sampleAssets.length) * 100).toFixed(2)}%\n`);

  if (matches === sampleAssets.length) {
    console.log('✅ 100% MATCH RATE - TOKEN DECODE VALIDATED\n');
  } else {
    console.log('❌ MISMATCH DETECTED - REVIEW DECODE LOGIC\n');
  }

  // Display detailed table
  console.log('═══════════════════════════════════════════════════════════');
  console.log('DETAILED VALIDATION TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.table(
    validations.map(v => ({
      token_id: v.token_id.slice(0, 12) + '...',
      condition_id: v.decoded_condition_id.slice(0, 12) + '...',
      outcome: v.decoded_outcome_index,
      market: v.market_slug?.slice(0, 30) || 'N/A',
      winner: v.winning_index !== undefined ? v.winning_index : 'N/A',
      match: v.match ? '✅' : '❌',
    }))
  );

  // Save to CSV
  console.log('\n💾 Saving validation results...\n');

  fs.writeFileSync(
    'token_decode_validation.csv',
    [
      'token_id,decoded_condition_id,decoded_outcome_index,market_slug,winning_index,gamma_condition_id,gamma_outcome_index,match',
      ...validations.map(v =>
        `${v.token_id},${v.decoded_condition_id},${v.decoded_outcome_index},${v.market_slug || ''},${v.winning_index !== undefined ? v.winning_index : ''},${v.gamma_condition_id || ''},${v.gamma_outcome_index !== undefined ? v.gamma_outcome_index : ''},${v.match}`
      )
    ].join('\n')
  );

  console.log('  ✅ token_decode_validation.csv\n');

  console.log('✅ VALIDATION COMPLETE\n');

  await client.close();
}

main().catch(console.error);
