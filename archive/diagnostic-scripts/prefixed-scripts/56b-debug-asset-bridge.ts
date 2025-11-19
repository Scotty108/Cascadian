/**
 * 56b: DEBUG ASSET BRIDGE ISSUE
 *
 * Debug the asset ID mismatch between our clob_fills and Polymarket API positions
 * to understand why our PnL calculations show zero realized gains.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

interface AssetInfo {
  asset_id: string;
  condition_id_norm: string | null;
  found_in_map: boolean;
  found_in_resolutions: boolean;
  has_resolved: boolean;
  resolution_data: any;
}

async function debugAssetBridge() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('56b: DEBUG ASSET BRIDGE ISSUE');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Test asset IDs from our first wallet vs API
  const ourAsset = '25676404126251793452437679998881673978615639981798882343338013469997779860823';
  const apiAsset = '53952044564797063399998308905160140348582487209790593516275555649105377638248';

  console.log('Test Asset IDs:');
  console.log(`Our asset:    ${ourAsset}`);
  console.log(`API asset:    ${apiAsset}`);
  console.log(`Assets match: ${ourAsset === apiAsset}\n`);

  console.log('=== Step 1: Check ctf_token_map bridge ===\n');

  // Check our asset in ctf_token_map
  const ourMapQuery = await clickhouse.query({
    query: `SELECT token_id, condition_id_norm FROM ctf_token_map WHERE token_id = '${ourAsset}' LIMIT 1`,
    format: 'JSONEachRow'
  });
  const ourMapResults = await ourMapQuery.json();

  // Check API asset in ctf_token_map
  const apiMapQuery = await clickhouse.query({
    query: `SELECT token_id, condition_id_norm FROM ctf_token_map WHERE token_id = '${apiAsset}' LIMIT 1`,
    format: 'JSONEachRow'
  });
  const apiMapResults = await apiMapQuery.json();

  console.log('Our asset in ctf_token_map:');
  if (ourMapResults.length > 0) {
    console.log('✓ Found:', ourMapResults[0]);
  } else {
    console.log('✗ NOT FOUND in ctf_token_map');
  }

  console.log('\nAPI asset in ctf_token_map:');
  if (apiMapResults.length > 0) {
    console.log('✓ Found:', apiMapResults[0]);
  } else {
    console.log('✗ NOT FOUND in ctf_token_map');
  }

  console.log('\n=== Step 2: Check market_resolutions_final ===\n');

  if (apiMapResults.length > 0) {
    const conditionId = apiMapResults[0].condition_id_norm;
    console.log(`Checking resolution for condition: ${conditionId}`);

    const resQuery = await clickhouse.query({
      query: `SELECT condition_id_norm, winning_index, resolved_at, payout_numerators FROM market_resolutions_final WHERE condition_id_norm = '${conditionId}' LIMIT 1`,
      format: 'JSONEachRow'
    });
    const resResults = await resQuery.json();

    console.log('Resolution data for API asset:');
    if (resResults.length > 0) {
      console.log('✓ Found:', resResults[0]);
    } else {
      console.log('✗ NOT FOUND in market_resolutions_final');
    }
  }

  console.log('\n=== Step 3: Sample trades from first wallet ===\n');

  // Get first wallet's trades to analyze
  const walletQuery = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        count(*) as trade_count,
        min(timestamp) as first_trade,
        max(timestamp) as last_trade
      FROM clob_fills
      WHERE proxy_wallet = '0x8a6276085b676a02098d83c199683e8a964168e1'
      GROUP BY asset_id
      ORDER BY trade_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const walletResults = await walletQuery.json();

  console.log('Top 5 assets by trade count:');
  for (const result of walletResults) {
    console.log(`\nAsset: ${result.asset_id}`);
    console.log(`  Trades: ${result.trade_count}`);
    console.log(`  Date range: ${result.first_trade} to ${result.last_trade}`);

    // Check if this asset exists in ctf_token_map
    const assetQuery = await clickhouse.query({
      query: `SELECT condition_id_norm FROM ctf_token_map WHERE token_id = '${result.asset_id}' LIMIT 1`,
      format: 'JSONEachRow'
    });
    const assetResults = await assetQuery.json();

    if (assetResults.length > 0) {
      console.log(`  ✓ Condition ID: ${assetResults[0].condition_id_norm}`);
    } else {
      console.log(`  ✗ No condition ID mapping found`);
    }
  }

  console.log('\n=== Step 4: Compare resolved vs open positions ===\n');

  // Check what percentage of wallet assets have resolutions
  for (const result of walletResults) {
    const assetId = result.asset_id;

    // Get condition ID
    const condQuery = await clickhouse.query({
      query: `SELECT condition_id_norm FROM ctf_token_map WHERE token_id = '${assetId}' LIMIT 1`,
      format: 'JSONEachRow'
    });
    const condResults = await condQuery.json();

    if (condResults.length > 0) {
      const conditionId = condResults[0].condition_id_norm;

      // Check resolution status
      const resQuery = await clickhouse.query({
        query: `SELECT winning_index, resolved_at FROM market_resolutions_final WHERE condition_id_norm = '${conditionId}' LIMIT 1`,
        format: 'JSONEachRow'
      });
      const resResults = await resQuery.json();

      if (resResults.length > 0) {
        console.log(`Asset ${assetId.substring(0,20)}...: RESOLVED (winning_index: ${resResults[0].winning_index})`);
      } else {
        console.log(`Asset ${assetId.substring(0,20)}...: OPEN`);
      }
    } else {
      console.log(`Asset ${assetId.substring(0,20)}...: NO CONDITION MAPPING`);
    }
  }

  console.log('\n=== Root Cause Analysis ===\n');

  // Check the Track A fixture to see what made it work
  const trackAResults = await analyzeTrackAFixture();
  console.log(trackAResults);
}

async function analyzeTrackAFixture() {
  console.log('=== Track A Fixture Analysis ===\n');

  // Sample a few assets from Track A fixture
  const sampleConditions = [
    '0x2696c95fc7d93be0e9cf2284c6c675f7e4e2d6cab35fa13fec62291873909a9b',
    '0x27284d4a7ae069eb35e427e84523b6628a75121a7d3470b7f17bcdcafa8b7eab',
    '0x561bf9455ee586b9b8f5e7b3e0a2a840cac00e2e7a0c1c5fb5e77a23143db2d'
  ];

  for (const conditionId of sampleConditions) {
    console.log(`Condition: ${conditionId}`);

    const query = await clickhouse.query({
      query: `SELECT winning_index, resolved_at FROM market_resolutions_final WHERE condition_id_norm = '${conditionId}' LIMIT 1`,
      format: 'JSONEachRow'
    });
    const results = await query.json();

    if (results.length > 0) {
      console.log(`  ✓ Resolution: winning_index=${results[0].winning_index}, resolved_at=${results[0].resolved_at}`);
    } else {
      console.log(`  ✗ No resolution found`);
    }
  }

  return 'Track A analysis complete';
}

async function main() {
  try {
    await debugAssetBridge();
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);