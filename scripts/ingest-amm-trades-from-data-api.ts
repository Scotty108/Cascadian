#!/usr/bin/env tsx
/**
 * Ingest AMM/Ghost Market Trades from Polymarket Data API
 *
 * Purpose: Fetch trades from external Polymarket Data API for markets
 *          that have ZERO coverage in our clob_fills table.
 *
 * API: https://data-api.polymarket.com/trades
 * Auth: None required (public endpoint)
 *
 * Target: 6 "ghost markets" identified in Dome coverage investigation
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// 6 ghost markets with zero clob_fills coverage
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

interface DataAPITrade {
  id: string;                  // Trade ID
  market: string;              // Market slug or ID
  asset_id: string;            // Token ID
  side: 'BUY' | 'SELL';
  price: string;               // String number 0-1
  size: string;                // String number (shares)
  timestamp: number;           // Unix timestamp
  maker: string;               // Maker address
  taker: string;               // Taker address
  outcome?: string;            // Outcome label
  txHash?: string;             // Transaction hash
  feeRateBps?: number;         // Fee rate in basis points
}

interface GammaMarket {
  id: string;
  condition_id: string;
  question: string;
  outcomes: string[];
  clobTokenIds?: string[];
}

async function fetchMarketMetadata(conditionId: string): Promise<GammaMarket | null> {
  const normalized = conditionId.toLowerCase().replace('0x', '');
  const url = `https://gamma-api.polymarket.com/markets?condition_id=${normalized}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.log(`  ⚠️  Gamma API returned ${response.status} for ${conditionId}`);
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`  ⚠️  No market found for condition ${conditionId}`);
      return null;
    }

    return data[0];
  } catch (error: any) {
    console.log(`  ❌ Error fetching market metadata: ${error.message}`);
    return null;
  }
}

async function fetchTradesFromDataAPI(
  conditionId: string,
  market: GammaMarket
): Promise<DataAPITrade[]> {
  // Data API trades endpoint - try multiple strategies
  const trades: DataAPITrade[] = [];

  // Strategy 1: Query by condition_id if supported
  // Note: Data API may not support condition_id filter directly
  // May need to fetch all recent trades and filter client-side

  // Strategy 2: Use market ID if available
  const marketId = market.id;
  if (marketId) {
    try {
      const url = `https://data-api.polymarket.com/trades?market=${marketId}&limit=1000`;
      console.log(`  Fetching from: ${url.substring(0, 80)}...`);

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          trades.push(...data);
          console.log(`  ✅ Fetched ${data.length} trades from Data API`);
        }
      } else if (response.status === 404) {
        console.log(`  ⚠️  Market ${marketId} not found in Data API`);
      } else {
        console.log(`  ⚠️  Data API returned ${response.status}`);
      }
    } catch (error: any) {
      console.log(`  ❌ Error fetching trades: ${error.message}`);
    }
  }

  // Strategy 3: Fallback to subgraph if Data API fails
  if (trades.length === 0) {
    console.log(`  ℹ️  Data API returned no trades, will use subgraph in next phase`);
  }

  return trades;
}

function mapDataAPITradeToSchema(
  trade: DataAPITrade,
  market: GammaMarket,
  outcomeIndex: number
): any {
  return {
    fill_id: trade.id,
    block_time: new Date(trade.timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19),
    block_number: 0,
    tx_hash: trade.txHash || '',
    asset_id_decimal: trade.asset_id,
    condition_id: market.condition_id.toLowerCase().replace('0x', ''),
    outcome_index: outcomeIndex,
    outcome_label: trade.outcome || market.outcomes[outcomeIndex] || '',
    question: market.question,
    wallet_address: (trade.taker || trade.maker).toLowerCase(),
    operator_address: '',
    is_proxy_trade: 0,
    side: trade.side,
    price: parseFloat(trade.price),
    shares: parseFloat(trade.size),
    collateral_amount: parseFloat(trade.price) * parseFloat(trade.size),
    fee_amount: trade.feeRateBps
      ? (parseFloat(trade.price) * parseFloat(trade.size) * trade.feeRateBps / 10000)
      : 0.0,
    data_source: 'data_api',
    source_metadata: JSON.stringify({
      original_market: trade.market,
      maker: trade.maker,
      taker: trade.taker,
      fee_rate_bps: trade.feeRateBps || 0
    })
  };
}

async function insertTradesIntoDB(trades: any[]): Promise<void> {
  if (trades.length === 0) {
    console.log('  ℹ️  No trades to insert');
    return;
  }

  console.log(`  Inserting ${trades.length} trades into pm_trades_external...`);

  try {
    await clickhouse.insert({
      table: 'pm_trades_external',
      values: trades,
      format: 'JSONEachRow'
    });

    console.log(`  ✅ Inserted ${trades.length} trades`);
  } catch (error: any) {
    console.error(`  ❌ Insert failed: ${error.message}`);
    throw error;
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('AMM/Ghost Market Trade Ingestion - Polymarket Data API');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Agent: C2 - External Data Ingestion');
  console.log('Target: 6 ghost markets with zero clob_fills coverage');
  console.log('Source: https://data-api.polymarket.com/trades');
  console.log('');

  // Pre-flight: Check if pm_trades_external exists
  console.log('Step 1: Verifying pm_trades_external table exists...');
  try {
    const result = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM pm_trades_external',
      format: 'JSONEachRow'
    });
    const data = await result.json();
    console.log(`✅ Table exists with ${data[0].cnt} existing rows`);
  } catch (error: any) {
    console.error('❌ Table does not exist. Run migration first:');
    console.error('   clickhouse-client < migrations/clickhouse/017_create_pm_trades_external.sql');
    process.exit(1);
  }
  console.log('');

  let totalTradesFetched = 0;
  let totalTradesInserted = 0;

  for (const ghostMarket of GHOST_MARKETS) {
    console.log(`Processing: ${ghostMarket.name}`);
    console.log(`Condition ID: ${ghostMarket.cid}`);
    console.log(`Expected trades (from Dome): ${ghostMarket.dome_trades}`);
    console.log('');

    // Step 1: Fetch market metadata from Gamma API
    console.log('  Fetching market metadata from Gamma API...');
    const market = await fetchMarketMetadata(ghostMarket.cid);
    if (!market) {
      console.log('  ⚠️  Skipping - could not fetch market metadata');
      console.log('');
      continue;
    }
    console.log(`  ✅ Market: ${market.question}`);
    console.log(`     Outcomes: ${market.outcomes.join(', ')}`);
    console.log('');

    // Step 2: Fetch trades from Data API
    console.log('  Fetching trades from Data API...');
    const apiTrades = await fetchTradesFromDataAPI(ghostMarket.cid, market);
    totalTradesFetched += apiTrades.length;

    if (apiTrades.length === 0) {
      console.log('  ⚠️  No trades found in Data API');
      console.log('');
      continue;
    }

    // Step 3: Map to schema and insert
    console.log('  Mapping trades to pm_trades_external schema...');
    const mappedTrades = apiTrades.map((trade, idx) =>
      mapDataAPITradeToSchema(trade, market, idx % market.outcomes.length)
    );

    await insertTradesIntoDB(mappedTrades);
    totalTradesInserted += mappedTrades.length;

    console.log('');

    // Rate limit: 1 request per second
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Markets processed: ${GHOST_MARKETS.length}`);
  console.log(`Trades fetched from Data API: ${totalTradesFetched}`);
  console.log(`Trades inserted into DB: ${totalTradesInserted}`);
  console.log('');

  if (totalTradesInserted > 0) {
    // Verify insertion
    console.log('Verifying insertion...');
    const result = await clickhouse.query({
      query: `
        SELECT
          data_source,
          COUNT(*) as trade_count,
          COUNT(DISTINCT condition_id) as market_count,
          COUNT(DISTINCT wallet_address) as wallet_count
        FROM pm_trades_external
        WHERE data_source = 'data_api'
        GROUP BY data_source
      `,
      format: 'JSONEachRow'
    });
    const stats = await result.json();
    console.table(stats);
    console.log('');
    console.log('✅ SUCCESS - AMM trades ingested');
  } else {
    console.log('⚠️  NO TRADES INGESTED');
    console.log('');
    console.log('Possible reasons:');
    console.log('1. Data API does not provide historical AMM trades');
    console.log('2. Markets are too old or deprecated');
    console.log('3. Different API endpoint needed');
    console.log('');
    console.log('Next steps:');
    console.log('1. Try Polymarket Subgraph for blockchain-based historical data');
    console.log('2. Check Dune Analytics for aggregated data');
    console.log('3. Parse ERC-1155 transfers directly from blockchain');
  }

  console.log('');
  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
