#!/usr/bin/env tsx
/**
 * CLOB API Probe for Missing Markets
 *
 * Queries the official Polymarket CLOB API directly to determine if the 14 missing
 * markets exist in their system.
 *
 * This is the fork in the road:
 * - If CLOB API has the data → our ingestion is broken
 * - If CLOB API has nothing → Dome uses different sources (AMM, internal indexer)
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// Sample condition_ids to probe (start with 3 to avoid rate limits)
const SAMPLE_CONDITION_IDS = [
  {
    id: '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    name: 'Xi Jinping out in 2025',
    dome_trades: 14,
    dome_shares: 19999.99
  },
  {
    id: '0x93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620',
    name: 'Inflation 2.7% in August',
    dome_trades: 65,
    dome_shares: 33894.33
  },
  {
    id: '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    name: 'Satoshi Bitcoin 2025',
    dome_trades: 1,
    dome_shares: 1000.00
  }
];

async function probeMarket(conditionId: string, marketName: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Market: ${marketName}`);
  console.log(`Condition ID: ${conditionId}`);
  console.log('='.repeat(80));

  const results = {
    market_name: marketName,
    condition_id: conditionId,
    clob_trades_api: 0,
    clob_orderbook_exists: false,
    clob_markets_api: false,
    error: null as string | null
  };

  // Endpoint 1: GET /trades (historical trades for a market)
  console.log('\n1. Checking CLOB /trades endpoint...');
  try {
    const tradesUrl = `https://clob.polymarket.com/trades?condition_id=${conditionId}`;
    console.log(`   URL: ${tradesUrl}`);

    const tradesResp = await fetch(tradesUrl, {
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (tradesResp.ok) {
      const trades = await tradesResp.json();
      results.clob_trades_api = Array.isArray(trades) ? trades.length : 0;
      console.log(`   ✅ Response: ${results.clob_trades_api} trades`);

      if (results.clob_trades_api > 0) {
        console.log(`   Sample trade:`, JSON.stringify(trades[0], null, 2).substring(0, 300));
      }
    } else {
      console.log(`   ⚠️  HTTP ${tradesResp.status}: ${tradesResp.statusText}`);
      results.error = `HTTP ${tradesResp.status}`;
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    results.error = error.message;
  }

  // Endpoint 2: GET /markets (market metadata)
  console.log('\n2. Checking CLOB /markets endpoint...');
  try {
    const marketsUrl = `https://clob.polymarket.com/markets/${conditionId}`;
    console.log(`   URL: ${marketsUrl}`);

    const marketsResp = await fetch(marketsUrl, {
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (marketsResp.ok) {
      const market = await marketsResp.json();
      results.clob_markets_api = true;
      console.log(`   ✅ Market found`);
      console.log(`   Sample:`, JSON.stringify(market, null, 2).substring(0, 300));
    } else if (marketsResp.status === 404) {
      console.log(`   ❌ Market NOT FOUND (404)`);
    } else {
      console.log(`   ⚠️  HTTP ${marketsResp.status}: ${marketsResp.statusText}`);
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Endpoint 3: GET /book (orderbook - indicates if market is active)
  console.log('\n3. Checking CLOB /book endpoint...');
  try {
    // Note: We need token_id, not condition_id for orderbook
    // This is a limitation - we'd need to derive token_id from condition_id
    console.log(`   ⚠️  Skipped: Requires token_id (not condition_id)`);
    console.log(`   Would need to query market metadata first to get token_ids`);
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  return results;
}

async function probeProxyWallet() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Proxy Wallet Probe: ${XCN_PROXY}`);
  console.log('='.repeat(80));

  // Endpoint: GET /rewards (user's trading history)
  console.log('\n1. Checking CLOB /rewards endpoint (user history)...');
  try {
    const rewardsUrl = `https://clob.polymarket.com/rewards?address=${XCN_PROXY}`;
    console.log(`   URL: ${rewardsUrl}`);

    const rewardsResp = await fetch(rewardsUrl, {
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (rewardsResp.ok) {
      const rewards = await rewardsResp.json();
      console.log(`   ✅ Response:`, JSON.stringify(rewards, null, 2).substring(0, 500));
    } else {
      console.log(`   ⚠️  HTTP ${rewardsResp.status}: ${rewardsResp.statusText}`);
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Note: There's no direct "get all trades for address" endpoint on CLOB
  // Would need to:
  // 1. Query Polymarket Data API for positions
  // 2. Extract market IDs
  // 3. Query CLOB for trades on those markets
  console.log('\n2. Note on wallet trade history:');
  console.log('   CLOB API does not have a "trades by address" endpoint.');
  console.log('   Alternative: Use Polymarket Data API (/positions?user=...) to find markets,');
  console.log('   then query CLOB /trades for each market and filter by address.');
}

async function main() {
  console.log('🔍 CLOB API Probe: Missing Markets');
  console.log('='.repeat(80));
  console.log('');
  console.log('Purpose: Determine if Polymarket CLOB has the data we\'re missing');
  console.log('');

  const results: any[] = [];

  // Probe sample markets
  for (const market of SAMPLE_CONDITION_IDS) {
    const result = await probeMarket(market.id, market.name);
    results.push(result);

    // Rate limit: wait 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Probe proxy wallet
  await probeProxyWallet();

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  console.table(results.map(r => ({
    'Market': r.market_name.substring(0, 30),
    'CLOB Trades': r.clob_trades_api,
    'CLOB Market': r.clob_markets_api ? 'YES' : 'NO',
    'Error': r.error || 'None'
  })));

  console.log('');
  console.log('Conclusion:');

  const marketsWithTrades = results.filter(r => r.clob_trades_api > 0).length;
  const marketsWithMetadata = results.filter(r => r.clob_markets_api).length;

  if (marketsWithTrades === 0) {
    console.log('❌ CLOB API has ZERO trades for these markets');
    console.log('   This means:');
    console.log('   1. Dome is NOT using CLOB as the source for these trades');
    console.log('   2. Possible sources: AMM trades, internal Dome indexer, or different market IDs');
    console.log('   3. Next step: Contact Dome or check if these are AMM markets');
  } else if (marketsWithTrades > 0 && marketsWithTrades < results.length) {
    console.log('⚠️  CLOB API has trades for SOME markets but not all');
    console.log('   This suggests:');
    console.log('   1. Some markets are CLOB, some are AMM');
    console.log('   2. Our ingestion may be missing specific market types');
    console.log('   3. Next step: Check market type patterns (binary vs scalar, etc.)');
  } else {
    console.log('✅ CLOB API has trades for ALL checked markets');
    console.log('   This means:');
    console.log('   1. The data EXISTS in Polymarket CLOB');
    console.log('   2. Our ingestion is BROKEN or incomplete');
    console.log('   3. Next step: Fix Goldsky subgraph or backfill logic');
  }

  console.log('');
  console.log('📚 API Documentation:');
  console.log('   - Official CLOB API: https://docs.polymarket.com/#clob-api');
  console.log('   - Data API: https://docs.polymarket.com/#data-api');
  console.log('   - py-clob-client reference: Check endpoints and parameters');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
