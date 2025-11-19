#!/usr/bin/env tsx
/**
 * Phase 1: Prove AMM Hypothesis Using Polymarket Data API
 *
 * Fetches trades from Polymarket Data API for the 6 "ghost" markets
 * (those with zero data in our CLOB tables) for xcnstrategy wallet.
 *
 * Goal: Validate that these trades exist and can close the Dome gap.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// 6 "ghost" markets - completely absent from our CLOB tables
const GHOST_MARKETS = [
  {
    cid: '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    name: 'Satoshi Bitcoin 2025',
    dome_trades: 1,
    dome_shares: 1000.00
  },
  {
    cid: '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    name: 'Xi Jinping 2025 / Biden Coronavirus',
    dome_trades: 14,
    dome_shares: 19999.99
  },
  {
    cid: '0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
    name: 'Trump Gold Cards',
    dome_trades: 3,
    dome_shares: 2789.14
  },
  {
    cid: '0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
    name: 'Elon Budget Cut',
    dome_trades: 1,
    dome_shares: 100.00
  },
  {
    cid: '0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
    name: 'US Ally Nuke 2025',
    dome_trades: 1,
    dome_shares: 1.00
  },
  {
    cid: '0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
    name: 'China Bitcoin Unban',
    dome_trades: 1,
    dome_shares: 1.00
  }
];

interface APITrade {
  market: string;
  asset_id: string;
  outcome: string;
  price: number;
  size: number;
  side: string;
  timestamp: string;
  trader_address: string;
  match_time?: string;
  bucket_index?: number;
}

async function fetchTradesForMarket(conditionId: string, marketName: string) {
  console.log(`\nFetching trades for: ${marketName}`);
  console.log(`Condition ID: ${conditionId}`);
  console.log('');

  // Try Polymarket Data API endpoint
  // Note: Actual endpoint may vary - using /positions or /events endpoints
  const results: APITrade[] = [];

  // Attempt 1: Try gamma-api markets endpoint to get market slug
  try {
    const marketsUrl = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
    console.log(`  Checking Gamma API for market metadata...`);

    const marketsResp = await fetch(marketsUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (marketsResp.ok) {
      const data = await marketsResp.json();
      if (Array.isArray(data) && data.length > 0) {
        const market = data[0];
        console.log(`  ✅ Found market: ${market.question}`);
        console.log(`     Slug: ${market.slug || 'N/A'}`);
        console.log(`     CLOB token IDs: ${market.clob_token_ids || 'N/A'}`);

        // If we have clob_token_ids, we could try /trades endpoint
        if (market.clob_token_ids && Array.isArray(market.clob_token_ids)) {
          for (const tokenId of market.clob_token_ids) {
            console.log(`  Checking trades for token_id: ${tokenId}...`);

            // Try /events endpoint (may have more data than /trades)
            const eventsUrl = `https://clob.polymarket.com/events?token_id=${tokenId}`;
            try {
              const eventsResp = await fetch(eventsUrl, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(10000)
              });

              if (eventsResp.ok) {
                const events = await eventsResp.json();
                console.log(`    Response: ${JSON.stringify(events).substring(0, 200)}`);
              } else if (eventsResp.status === 401) {
                console.log(`    ⚠️  401 Unauthorized (auth required)`);
              } else {
                console.log(`    ⚠️  HTTP ${eventsResp.status}`);
              }
            } catch (e: any) {
              console.log(`    ❌ Error: ${e.message}`);
            }
          }
        }
      }
    } else {
      console.log(`  ⚠️  HTTP ${marketsResp.status}`);
    }
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }

  return results;
}

async function main() {
  console.log('Phase 1: AMM Hypothesis Proof - API Data Fetch');
  console.log('='.repeat(80));
  console.log('');
  console.log('Goal: Fetch trades from Polymarket APIs for 6 ghost markets');
  console.log(`Wallet: ${XCN_EOA}`);
  console.log(`Proxy: ${XCN_PROXY}`);
  console.log('');

  const allTrades: APITrade[] = [];

  for (const market of GHOST_MARKETS) {
    const trades = await fetchTradesForMarket(market.cid, market.name);
    allTrades.push(...trades);

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Total API trades fetched: ${allTrades.length}`);
  console.log('');

  if (allTrades.length === 0) {
    console.log('⚠️  No trades fetched from API');
    console.log('');
    console.log('Next steps:');
    console.log('1. Research correct Polymarket Data API endpoints');
    console.log('2. Check if authentication is required');
    console.log('3. Alternative: Use Dune Analytics API or blockchain events directly');
    console.log('');
    console.log('Note: CLOB API /trades endpoint requires authentication.');
    console.log('May need to use alternative data source for AMM trades.');
  } else {
    console.log('✅ Trades fetched successfully');
    console.log('Next: Insert into pm_trades_amm_temp and test P&L impact');
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
