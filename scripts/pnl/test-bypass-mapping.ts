/**
 * TEST BYPASS MAPPING
 *
 * This script bypasses the stale pm_token_to_condition_map_v3 by:
 * 1. Fetching market data directly from Gamma API for unmapped tokens
 * 2. Calculating PnL manually from pm_trader_events_v2
 * 3. Comparing to the UI PnL (-$293.91 for wallet 0xdcd7007b...)
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';

const FAILING_WALLET = '0xdcd7007b1a0b1e118684c47f6aaf8ba1b032a2d2';
const UI_PNL = -293.91;

interface GammaMarket {
  question: string;
  conditionId: string;
  clobTokenIds: string; // JSON string array
  outcomePrices: string; // JSON string array
  closed: boolean;
}

interface TokenMapping {
  token_id: string;
  condition_id: string;
  outcome_index: number;
  question: string;
  current_price: number;
  is_resolved: boolean;
}

interface Trade {
  token_id: string;
  side: string;
  usdc_amount: number;
  token_amount: number;
  trade_time: string;
}

// Fetch market data from Gamma API by token_id
async function fetchMarketFromAPI(tokenId: string): Promise<TokenMapping | null> {
  const url = `https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}&limit=1`;

  try {
    const response = await fetch(url);
    const markets = await response.json() as GammaMarket[];

    if (markets.length === 0) {
      return null;
    }

    const market = markets[0];
    const clobTokenIds = JSON.parse(market.clobTokenIds) as string[];
    const outcomePrices = JSON.parse(market.outcomePrices) as string[];

    const outcomeIndex = clobTokenIds.indexOf(tokenId);
    if (outcomeIndex === -1) {
      return null;
    }

    return {
      token_id: tokenId,
      condition_id: market.conditionId,
      outcome_index: outcomeIndex,
      question: market.question,
      current_price: parseFloat(outcomePrices[outcomeIndex]),
      is_resolved: market.closed,
    };
  } catch (err) {
    console.error(`Failed to fetch market for token ${tokenId}:`, err);
    return null;
  }
}

// Get all trades for the wallet from pm_trader_events_v2
async function getWalletTrades(wallet: string): Promise<Trade[]> {
  const query = `
    SELECT
      token_id,
      side,
      usdc_amount / 1e6 as usdc_amount,
      token_amount / 1e6 as token_amount,
      trade_time
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
    ORDER BY trade_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as Trade[];
}

// Calculate PnL from trades and mappings
// For market makers: aggregate by MARKET (condition_id), not token
// This properly accounts for offsetting positions on both outcomes
function calculatePnL(trades: Trade[], mappings: Map<string, TokenMapping>): {
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  marketPnL: Map<string, { question: string; cashFlow: number; value: number; pnl: number }>;
} {
  // Step 1: Calculate per-token positions
  const tokenPositions = new Map<string, { shares: number; cashFlow: number }>();

  for (const trade of trades) {
    const pos = tokenPositions.get(trade.token_id) || { shares: 0, cashFlow: 0 };

    if (trade.side.toLowerCase() === 'buy') {
      pos.shares += trade.token_amount;
      pos.cashFlow -= trade.usdc_amount;
    } else {
      pos.shares -= trade.token_amount;
      pos.cashFlow += trade.usdc_amount;
    }

    tokenPositions.set(trade.token_id, pos);
  }

  // Step 2: Aggregate by MARKET (condition_id)
  // For binary markets, both outcomes belong to same condition_id
  const marketPnL = new Map<string, { question: string; cashFlow: number; value: number; pnl: number; resolved: boolean }>();

  console.log('');
  console.log('  Per-token breakdown:');

  for (const [tokenId, pos] of tokenPositions) {
    const mapping = mappings.get(tokenId);
    if (!mapping) {
      console.log(`  WARNING: No mapping for token ${tokenId.substring(0, 20)}...`);
      continue;
    }

    const currentValue = pos.shares * mapping.current_price;
    const tokenPnl = pos.cashFlow + currentValue;

    console.log(`  ${mapping.question.substring(0, 30)}... (out=${mapping.outcome_index}): shares=${pos.shares.toFixed(0)}, cash=$${pos.cashFlow.toFixed(2)}, val=$${currentValue.toFixed(2)}, pnl=$${tokenPnl.toFixed(2)}`);

    // Aggregate into market
    const marketEntry = marketPnL.get(mapping.condition_id) || {
      question: mapping.question,
      cashFlow: 0,
      value: 0,
      pnl: 0,
      resolved: mapping.is_resolved,
    };

    marketEntry.cashFlow += pos.cashFlow;
    marketEntry.value += currentValue;
    marketEntry.pnl += tokenPnl;
    marketPnL.set(mapping.condition_id, marketEntry);
  }

  // Step 3: Calculate totals from market-level aggregation
  let totalPnl = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;

  console.log('');
  console.log('  Per-MARKET breakdown (aggregated):');

  for (const [condId, market] of marketPnL) {
    console.log(`  ${market.question.substring(0, 40)}...`);
    console.log(`    Net cash: $${market.cashFlow.toFixed(2)}, Net value: $${market.value.toFixed(2)}, PnL: $${market.pnl.toFixed(2)}`);

    totalPnl += market.pnl;
    if (market.resolved) {
      realizedPnl += market.pnl;
    } else {
      unrealizedPnl += market.pnl;
    }
  }

  return { totalPnl, realizedPnl, unrealizedPnl, marketPnL };
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST BYPASS MAPPING: PnL via Gamma API                                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Wallet: ${FAILING_WALLET}`);
  console.log(`UI PnL: $${UI_PNL.toFixed(2)}`);
  console.log('');

  // Step 1: Get all trades
  console.log('=== STEP 1: Fetching trades from pm_trader_events_v2 ===');
  const trades = await getWalletTrades(FAILING_WALLET);
  console.log(`Found ${trades.length} trades`);

  // Get unique token_ids
  const tokenIds = [...new Set(trades.map(t => t.token_id))];
  console.log(`Unique tokens: ${tokenIds.length}`);
  console.log('');

  // Step 2: Fetch mappings from Gamma API
  console.log('=== STEP 2: Fetching market data from Gamma API ===');
  const mappings = new Map<string, TokenMapping>();

  for (const tokenId of tokenIds) {
    const mapping = await fetchMarketFromAPI(tokenId);
    if (mapping) {
      mappings.set(tokenId, mapping);
      console.log(`✓ ${tokenId.substring(0, 15)}... -> ${mapping.question.substring(0, 35)}... (price: ${mapping.current_price.toFixed(3)})`);
    } else {
      console.log(`✗ ${tokenId.substring(0, 15)}... -> NOT FOUND`);
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('');

  // Step 3: Calculate PnL
  console.log('=== STEP 3: Calculating PnL ===');
  const { totalPnl, realizedPnl, unrealizedPnl } = calculatePnL(trades, mappings);
  console.log('');

  // Step 4: Compare
  console.log('=== RESULTS ===');
  console.log(`  Calculated Total PnL:  $${totalPnl.toFixed(2)}`);
  console.log(`  Calculated Realized:   $${realizedPnl.toFixed(2)}`);
  console.log(`  Calculated Unrealized: $${unrealizedPnl.toFixed(2)}`);
  console.log(`  UI PnL:                $${UI_PNL.toFixed(2)}`);
  console.log(`  Delta:                 $${(totalPnl - UI_PNL).toFixed(2)}`);
  console.log('');

  const deltaPct = Math.abs((totalPnl - UI_PNL) / Math.max(Math.abs(UI_PNL), 1)) * 100;
  if (deltaPct <= 5) {
    console.log('✓ MATCH within 5%!');
  } else if (deltaPct <= 10) {
    console.log('~ CLOSE within 10%');
  } else {
    console.log(`✗ MISMATCH (${deltaPct.toFixed(1)}% delta)`);
    console.log('');
    console.log('Possible reasons for mismatch:');
    console.log('  1. Trades executed at different prices than current market prices');
    console.log('  2. Mark-to-market vs realized PnL differences');
    console.log('  3. Fee handling differences');
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
