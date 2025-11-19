#!/usr/bin/env tsx
/**
 * Test Polymarket Data API Integration
 *
 * This script demonstrates how to use the Polymarket Data API to fetch
 * wallet positions and P&L data.
 *
 * APIs tested:
 * 1. Data API - Wallet positions with P&L
 * 2. Goldsky Subgraph - Payout vectors
 * 3. Gamma API - Market metadata
 */

// Test wallet: Shows $332K loss on Polymarket UI but $0 in our system
const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

// ============================================================================
// 1. POLYMARKET DATA API
// ============================================================================

interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
}

async function getWalletPositions(
  address: string,
  options?: {
    redeemable?: boolean;
    limit?: number;
    sortBy?: 'CASHPNL' | 'PERCENTPNL' | 'TOKENS' | 'CURRENT';
    sortDirection?: 'ASC' | 'DESC';
  }
): Promise<Position[]> {
  const params = new URLSearchParams({
    user: address.toLowerCase(),
    limit: String(options?.limit || 500),
    sortBy: options?.sortBy || 'CASHPNL',
    sortDirection: options?.sortDirection || 'DESC',
  });

  if (options?.redeemable !== undefined) {
    params.set('redeemable', String(options.redeemable));
  }

  const url = `https://data-api.polymarket.com/positions?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Data API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// 2. GOLDSKY SUBGRAPH
// ============================================================================

interface Condition {
  id: string; // condition_id (0x-prefixed hex)
  payouts: string[]; // e.g., ["1", "0"] or ["0.54", "0.46"]
}

const GOLDSKY_ENDPOINT =
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';

async function getResolvedConditions(first = 1000, skip = 0): Promise<Condition[]> {
  const query = `{
    conditions(
      first: ${first}
      skip: ${skip}
      where: {payouts_not: null}
    ) {
      id
      payouts
    }
  }`;

  const response = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.data.conditions;
}

// ============================================================================
// 3. GAMMA API
// ============================================================================

interface Market {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string; // JSON string: '["Yes", "No"]'
  outcomePrices: string; // JSON string: '["0.65", "0.35"]'
  volume: string;
  closed: boolean;
  clobTokenIds: string; // JSON string
}

async function getMarketByConditionId(conditionId: string): Promise<Market[]> {
  const url = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getClosedMarkets(limit = 100, offset = 0): Promise<Market[]> {
  const url = `https://gamma-api.polymarket.com/markets?closed=true&limit=${limit}&offset=${offset}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('POLYMARKET API INTEGRATION TEST');
  console.log('='.repeat(80));
  console.log();

  // Test 1: Get wallet positions from Data API
  console.log(`Test 1: Fetching positions for wallet ${TEST_WALLET}...`);
  console.log();

  try {
    const positions = await getWalletPositions(TEST_WALLET, {
      redeemable: true,
      limit: 10,
      sortBy: 'CASHPNL',
    });

    console.log(`✅ Found ${positions.length} redeemable positions`);
    console.log();

    // Calculate total P&L
    const totalCashPnl = positions.reduce((sum, p) => sum + p.cashPnl, 0);
    const totalRealizedPnl = positions.reduce((sum, p) => sum + p.realizedPnl, 0);

    console.log('📊 P&L Summary (Top 10 Redeemable):');
    console.log(`   Total Cash P&L: $${totalCashPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Total Realized P&L: $${totalRealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log();

    console.log('🔝 Top 5 Positions by Cash P&L:');
    positions.slice(0, 5).forEach((pos, i) => {
      console.log(`   ${i + 1}. ${pos.title}`);
      console.log(`      Condition ID: ${pos.conditionId}`);
      console.log(`      Cash P&L: $${pos.cashPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`      Realized P&L: $${pos.realizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`      Size: ${pos.size.toLocaleString()} shares @ avg $${pos.avgPrice.toFixed(4)}`);
      console.log(`      Outcome: ${pos.outcome} (index ${pos.outcomeIndex})`);
      console.log();
    });
  } catch (error) {
    console.error('❌ Data API error:', error);
  }

  console.log('-'.repeat(80));
  console.log();

  // Test 2: Get payout vectors from Goldsky subgraph
  console.log('Test 2: Fetching payout vectors from Goldsky subgraph...');
  console.log();

  try {
    const conditions = await getResolvedConditions(10, 0);

    console.log(`✅ Found ${conditions.length} resolved conditions`);
    console.log();

    console.log('📋 Sample Conditions with Payouts:');
    conditions.slice(0, 5).forEach((cond, i) => {
      const payoutStr = cond.payouts.map((p, idx) => `[${idx}]=${p}`).join(', ');
      console.log(`   ${i + 1}. ${cond.id}`);
      console.log(`      Payouts: ${payoutStr}`);

      // Determine winner
      const maxPayout = Math.max(...cond.payouts.map(p => parseFloat(p)));
      const winnerIndex = cond.payouts.findIndex(p => parseFloat(p) === maxPayout);

      if (maxPayout === 1) {
        console.log(`      Winner: Outcome ${winnerIndex} (100% payout)`);
      } else {
        console.log(`      Winner: Partial payout (max ${(maxPayout * 100).toFixed(1)}%)`);
      }
      console.log();
    });
  } catch (error) {
    console.error('❌ Subgraph error:', error);
  }

  console.log('-'.repeat(80));
  console.log();

  // Test 3: Cross-reference with Gamma API
  console.log('Test 3: Fetching market metadata from Gamma API...');
  console.log();

  try {
    // Get first position's condition ID
    const positions = await getWalletPositions(TEST_WALLET, { limit: 1 });

    if (positions.length > 0) {
      const conditionId = positions[0].conditionId;
      console.log(`Looking up condition: ${conditionId}`);
      console.log();

      const markets = await getMarketByConditionId(conditionId);

      if (markets.length > 0) {
        const market = markets[0];
        console.log('✅ Market found in Gamma API:');
        console.log(`   Question: ${market.question}`);
        console.log(`   Slug: ${market.slug}`);
        console.log(`   Outcomes: ${market.outcomes}`);
        console.log(`   Volume: $${parseFloat(market.volume).toLocaleString()}`);
        console.log(`   Closed: ${market.closed}`);
        console.log(`   CLOB Token IDs: ${market.clobTokenIds}`);
      } else {
        console.log('⚠️  Market not found in Gamma API');
      }
    }
  } catch (error) {
    console.error('❌ Gamma API error:', error);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('✅ API INTEGRATION TEST COMPLETE');
  console.log('='.repeat(80));
  console.log();
  console.log('Next steps:');
  console.log('1. Create /lib/polymarket/data-api.ts client');
  console.log('2. Create ClickHouse table for API positions');
  console.log('3. Backfill top wallets');
  console.log('4. Compare against our calculated P&L');
  console.log();
}

// Run the tests
main().catch(console.error);
