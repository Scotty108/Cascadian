/**
 * 59: DEBUG ASSET MAPPING
 *
 * Debug the asset ID format mismatch between our fixture and Polymarket API
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

interface FixtureEntry {
  canonical_wallet: string;
  total_fills: string;
  total_markets: string;
  earliest_fill: string;
  latest_fill: string;
  trades: Array<{
    trade_id: string;
    timestamp: string;
    asset_id: string;
    side: string;
    size: number;
    price: number;
    cost: number;
  }>;
}

async function debugAssetMapping() {
  const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('59: DEBUG ASSET MAPPING');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Mission: Debug asset ID format mismatch for wallet ${targetWallet}`);

  try {
    // Step 1: Load fixture data and examine asset IDs
    console.log('\n📋 STEP 1: Examining fixture asset ID formats');
    const fixturePath = resolve(process.cwd(), 'fixture_track_b_wallets.json');
    const fixtureData = readFileSync(fixturePath, 'utf-8');
    const wallets: FixtureEntry[] = JSON.parse(fixtureData);

    const targetWalletEntry = wallets.find(w =>
      w.canonical_wallet.toLowerCase() === targetWallet.toLowerCase()
    );

    if (!targetWalletEntry) {
      console.log(`❌ Wallet ${targetWallet} not found in fixture`);
      return;
    }

    console.log(`✓ Found wallet with ${targetWalletEntry.trades.length} trades`);

    // Sample some asset IDs from our data
    console.log('\nSample asset IDs from our fixture:');
    const uniqueAssets = new Set(targetWalletEntry.trades.map(t => t.asset_id));
    const sampleAssets = Array.from(uniqueAssets).slice(0, 5);

    for (const assetId of sampleAssets) {
      console.log(`  - ${assetId}`);
      console.log(`    Length: ${assetId.length}`);
      console.log(`    Type: ${typeof assetId}`);
      console.log('');
    }

    console.log(`Total unique assets in fixture: ${uniqueAssets.size}`);

    // Step 2: Fetch API positions and examine asset IDs
    console.log('\n📋 STEP 2: Fetching API asset ID formats');
    const url = `https://data-api.polymarket.com/positions?user=${targetWallet}&limit=1000`;

    console.log(`  🌐 Fetching from: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const apiPositions = await response.json();
    const positions = Array.isArray(apiPositions) ? apiPositions : apiPositions.data || [];

    console.log(`✓ API returned ${positions.length} positions`);

    console.log('\nSample asset IDs from API:');
    const samplePositions = positions.slice(0, 5);

    for (const pos of samplePositions) {
      const assetId = pos.asset || pos.tokenId || 'UNKNOWN';
      const title = pos.title || 'Unknown Market';
      console.log(`  - ${title}`);
      console.log(`    Asset ID: ${assetId}`);
      console.log(`    Length: ${assetId.length}`);
      console.log(`    Type: ${typeof assetId}`);
      console.log('');
    }

    // Step 3: Check for possible mappings or conversions
    console.log('\n📋 STEP 3: Checking for possible asset ID relationships');

    // Get all unique API asset IDs
    const apiAssetIds = new Set(positions.map((pos: any) => pos.asset || pos.tokenId).filter(Boolean));
    const localAssetIds = uniqueAssets;

    console.log(`API unique assets: ${apiAssetIds.size}`);
    console.log(`Local unique assets: ${localAssetIds.size}`);

    // Look for overlaps (should be none, but let's check)
    const overlaps = [];
    for (const apiAsset of apiAssetIds) {
      if (localAssetIds.has(apiAsset)) {
        overlaps.push(apiAsset);
      }
    }

    console.log(`\nDirect overlaps found: ${overlaps.length}`);
    if (overlaps.length > 0) {
      console.log('Overlapping assets:');
      for (const overlap of overlaps) {
        console.log(`  - ${overlap}`);
      }
    }

    // Step 4: Check length distributions
    console.log('\n📋 STEP 4: Asset ID length analysis');

    const apiLengths = Array.from(apiAssetIds).map(id => id.length);
    const localLengths = Array.from(localAssetIds).map(id => id.length);

    const apiLengthsUnique = new Set(apiLengths);
    const localLengthsUnique = new Set(localLengths);

    console.log('\nAPI asset ID lengths:');
    for (const len of Array.from(apiLengthsUnique).sort()) {
      const count = apiLengths.filter(l => l === len).length;
      console.log(`  ${len} chars: ${count} assets`);
    }

    console.log('\nLocal asset ID lengths:');
    for (const len of Array.from(localLengthsUnique).sort()) {
      const count = localLengths.filter(l => l === len).length;
      console.log(`  ${len} chars: ${count} assets`);
    }

    // Check if we need to look up asset IDs in a different table
    console.log('\n📋 STEP 5: Suggested next steps');
    console.log('This analysis shows a clear format mismatch between our local asset IDs and API asset IDs.');
    console.log('');
    console.log('Possible causes:');
    console.log('1. Our asset_ids are token IDs, but API uses condition_id+outcome mapping');
    console.log('2. We need to bridge through ctf_token_map or similar tables');
    console.log('3. The API uses a different identifier system entirely');
    console.log('');
    console.log('Recommendations:');
    console.log('1. Check if ctf_token_map has mappings from our asset_id to API-compatible IDs');
    console.log('2. Confirm the exact format used by Polymarket API vs our data model');
    console.log('3. Build a proper asset_id -> API asset bridge if needed');

  } catch (error) {
    console.error('❌ Error during debugging:', error);
  }
}

debugAssetMapping().catch(console.error);