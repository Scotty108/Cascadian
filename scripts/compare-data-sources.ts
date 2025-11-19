#!/usr/bin/env npx tsx
/**
 * Compare Data Sources: Activity Subgraph vs ERC1155 Reconstruction
 *
 * Tests both approaches to get complete trading data for markets:
 * 1. Goldsky Activity Subgraph (direct API)
 * 2. ERC1155 token transfers (reconstruction from our DB)
 */

import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

// Test market (recent closed market missing from CLOB)
const TEST_MARKET = {
  condition_id: '0x54625984ec20476ea88ceeaa93c1e38f3bccdd038adf391744a9a0bc1222ff9e',
  token_id: '23595159900201440292163582921668176574982876357547003450906099724556243903822',
  question: 'Evansville Aces vs. Purdue Boilermakers: O/U 149.5'
};

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║         POLYMARKET DATA SOURCE COMPARISON                      ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

console.log(`Test Market: ${TEST_MARKET.question}`);
console.log(`Condition ID: ${TEST_MARKET.condition_id}`);
console.log(`Token ID: ${TEST_MARKET.token_id}\n`);

// ===========================================================================
// APPROACH 1: Activity Subgraph
// ===========================================================================
async function testActivitySubgraph() {
  console.log('═'.repeat(80));
  console.log('APPROACH 1: Goldsky Activity Subgraph');
  console.log('═'.repeat(80));

  const query = `
    query GetMarketActivity($conditionId: String!) {
      market(id: $conditionId) {
        id
        question
        outcomes
        volumeNum
        liquidityNum
        tradesNum
      }
    }
  `;

  try {
    const response = await fetch(
      'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { conditionId: TEST_MARKET.condition_id.toLowerCase() },
        }),
      }
    );

    const result = await response.json();

    if (result.errors) {
      console.log(`❌ API Error: ${result.errors[0].message}\n`);
      return { success: false, error: result.errors[0].message };
    }

    const market = result.data?.market;

    if (!market) {
      console.log('⚠️  Market not found in activity subgraph\n');
      return { success: false, data: null };
    }

    console.log('✅ Market found!\n');
    console.log(`Volume:      $${parseFloat(market.volumeNum).toLocaleString()}`);
    console.log(`Liquidity:   $${parseFloat(market.liquidityNum).toLocaleString()}`);
    console.log(`Trades:      ${market.tradesNum}`);
    console.log(`Outcomes:    ${market.outcomes?.join(', ') || 'N/A'}\n`);

    return { success: true, data: market };

  } catch (err) {
    console.log(`❌ Fetch error: ${(err as Error).message}\n`);
    return { success: false, error: (err as Error).message };
  }
}

// ===========================================================================
// APPROACH 2: ERC1155 Reconstruction
// ===========================================================================
async function testERC1155Reconstruction() {
  console.log('═'.repeat(80));
  console.log('APPROACH 2: ERC1155 Token Transfer Reconstruction');
  console.log('═'.repeat(80));

  const conditionIdClean = TEST_MARKET.condition_id.toLowerCase().replace('0x', '');

  try {
    // Step 1: Check if we have the token mapping
    console.log('\nStep 1: Check token mapping...');

    const mappingQuery = `
      SELECT
        token_id,
        condition_id_norm,
        outcome,
        question
      FROM ctf_token_map
      WHERE condition_id_norm = '${conditionIdClean}'
      LIMIT 5
    `;

    const mappingResult = await clickhouse.query({
      query: mappingQuery,
      format: 'JSONEachRow'
    });
    const mappings = await mappingResult.json<Array<{
      token_id: string;
      condition_id_norm: string;
      outcome: string;
      question: string;
    }>>();

    if (mappings.length === 0) {
      console.log('❌ No token mappings found for this market\n');
      return { success: false, reason: 'no_mapping' };
    }

    console.log(`✅ Found ${mappings.length} token mappings`);
    const tokenIds = mappings.map(m => m.token_id);

    // Step 2: Count ERC1155 transfers for these tokens
    console.log('\nStep 2: Count ERC1155 transfers...');

    const transferQuery = `
      SELECT
        count(*) as transfer_count,
        count(DISTINCT from_address) as unique_senders,
        count(DISTINCT to_address) as unique_receivers,
        min(block_timestamp) as first_trade,
        max(block_timestamp) as last_trade
      FROM erc1155_transfers
      WHERE token_id IN (${tokenIds.map(id => `'${id}'`).join(',')})
    `;

    const transferResult = await clickhouse.query({
      query: transferQuery,
      format: 'JSONEachRow'
    });
    const stats = await transferResult.json<Array<{
      transfer_count: string;
      unique_senders: string;
      unique_receivers: string;
      first_trade: string;
      last_trade: string;
    }>>();

    const count = parseInt(stats[0].transfer_count);

    if (count === 0) {
      console.log('⚠️  No ERC1155 transfers found\n');
      return { success: true, data: { transfers: 0 } };
    }

    console.log(`✅ Found ${count.toLocaleString()} token transfers\n`);
    console.log(`Unique senders:    ${stats[0].unique_senders}`);
    console.log(`Unique receivers:  ${stats[0].unique_receivers}`);
    console.log(`First trade:       ${stats[0].first_trade}`);
    console.log(`Last trade:        ${stats[0].last_trade}\n`);

    return {
      success: true,
      data: {
        transfers: count,
        senders: parseInt(stats[0].unique_senders),
        receivers: parseInt(stats[0].unique_receivers),
        first_trade: stats[0].first_trade,
        last_trade: stats[0].last_trade
      }
    };

  } catch (err) {
    console.log(`❌ Query error: ${(err as Error).message}\n`);
    return { success: false, error: (err as Error).message };
  }
}

// ===========================================================================
// APPROACH 3: CLOB Fills (baseline)
// ===========================================================================
async function testCLOBFills() {
  console.log('═'.repeat(80));
  console.log('BASELINE: CLOB Orderbook Fills');
  console.log('═'.repeat(80));

  const conditionIdClean = TEST_MARKET.condition_id.toLowerCase().replace('0x', '');

  const query = `
    SELECT count(*) as fill_count
    FROM clob_fills
    WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionIdClean}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json<Array<{ fill_count: string }>>();
  const count = parseInt(data[0].fill_count);

  console.log(`\n${count > 0 ? '✅' : '⚠️'}  CLOB fills: ${count}\n`);

  return { success: true, count };
}

// ===========================================================================
// MAIN COMPARISON
// ===========================================================================
async function main() {
  const activityResult = await testActivitySubgraph();
  const erc1155Result = await testERC1155Reconstruction();
  const clobResult = await testCLOBFills();

  console.log('═'.repeat(80));
  console.log('COMPARISON SUMMARY');
  console.log('═'.repeat(80));

  console.log('\nData Source Coverage:');
  console.log(`  CLOB Fills:           ${clobResult.count} fills`);
  console.log(`  Activity Subgraph:    ${activityResult.success ? `${activityResult.data?.tradesNum || 0} trades` : 'Failed'}`);
  console.log(`  ERC1155 Transfers:    ${erc1155Result.success ? `${erc1155Result.data?.transfers || 0} transfers` : 'Failed'}`);

  console.log('\n📊 FINDINGS:\n');

  if (activityResult.success && activityResult.data?.tradesNum > 0) {
    console.log('✅ Activity Subgraph has complete data');
    console.log('   → Use this for ALL trading data (CLOB + AMM)');
    console.log('   → Single API call, no reconstruction needed');
  } else {
    console.log('⚠️  Activity Subgraph: No data or unavailable');
  }

  if (erc1155Result.success && (erc1155Result.data?.transfers || 0) > 0) {
    console.log('\n✅ ERC1155 reconstruction possible');
    console.log('   → We have the raw transfer data');
    console.log('   → Requires token mapping + interpretation');
  } else if (erc1155Result.success && erc1155Result.data?.transfers === 0) {
    console.log('\n⚠️  ERC1155: No transfers found');
    console.log('   → Market truly has zero activity');
  } else {
    console.log('\n❌ ERC1155: Missing token mappings');
  }

  console.log('\n💡 RECOMMENDATION:\n');

  if (activityResult.success && activityResult.data) {
    console.log('Use Activity Subgraph as primary data source');
    console.log('  - Endpoint: activity-subgraph/0.0.4/gn');
    console.log('  - Pre-aggregated trade data');
    console.log('  - Includes CLOB + AMM activity');
    console.log('  - No complex reconstruction needed');
  } else if (erc1155Result.success && erc1155Result.data) {
    console.log('Fallback to ERC1155 reconstruction');
    console.log('  - Use ctf_token_map for token → condition mapping');
    console.log('  - Query erc1155_transfers table');
    console.log('  - Requires interpretation of transfer direction');
  } else {
    console.log('No data available for this market');
    console.log('  - Market created but never traded');
    console.log('  - Or: Outside data coverage window');
  }

  console.log('\n═'.repeat(80));
}

main().catch(console.error);
