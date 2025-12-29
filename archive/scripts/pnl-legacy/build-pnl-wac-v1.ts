/**
 * Build PnL using Weighted Average Cost (WAC) Methodology
 *
 * Based on research from PaulieB14's Polymarket-PnL-Substreams:
 * - Realized PnL on ANY sell (resolved or not)
 * - Formula: realized_pnl = sell_amount * (sell_price - avgPrice)
 * - avgPrice updates ONLY on buys: avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
 * - Resolution = final sell at resolved price (0 or 1)
 *
 * Terminal: Claude 3
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000, // 5 minutes
});

// Test wallets
const WHALE = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';
const EGG = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface Trade {
  event_id: string;
  side: string; // 'buy' or 'sell'
  condition_id: string;
  outcome_index: number;
  usdc_amount: number;
  token_amount: number;
  trade_time: string;
  block_number: number;
}

interface Position {
  amount: number;       // Current token holdings
  avgPrice: number;     // Weighted average cost basis
  realizedPnl: number;  // PnL from sells
  totalBought: number;  // Total tokens ever bought
  totalSold: number;    // Total tokens ever sold
}

interface Resolution {
  condition_id: string;
  winning_outcome: number;
  payout_numerators: number[];
  payout_denominator: number;
}

async function buildWACPnL(wallet: string, label: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n📊 Building WAC PnL for ${label}: ${wallet.slice(0, 10)}...\n`);

  // Step 1: Get all trades for this wallet (deduplicated)
  // Query from raw table to avoid view aggregation issues
  console.log('Step 1: Fetching trades (deduplicated)...');
  const tradesQuery = await clickhouse.query({
    query: `
      SELECT * FROM (
        SELECT
          event_id,
          any(side) as side,
          any(condition_id) as condition_id,
          any(outcome_index) as outcome_index,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount,
          any(trade_time) as trade_time,
          max(block_number) as block_number
        FROM (
          SELECT
            t.event_id AS event_id,
            t.side AS side,
            m.condition_id AS condition_id,
            m.outcome_index AS outcome_index,
            t.usdc_amount / 1000000.0 AS usdc_amount,
            t.token_amount / 1000000.0 AS token_amount,
            t.trade_time AS trade_time,
            t.block_number AS block_number
          FROM pm_trader_events_v2 t
          LEFT JOIN pm_token_to_condition_map_v3 m
            ON t.token_id = m.token_id_dec
          WHERE t.trader_wallet = '${wallet}'
            AND t.is_deleted = 0
            AND m.condition_id != ''
            AND m.condition_id IS NOT NULL
        )
        GROUP BY event_id
      )
      ORDER BY trade_time ASC, block_number ASC
    `,
    format: 'JSONEachRow'
  });

  const trades: Trade[] = await tradesQuery.json() as Trade[];
  console.log(`   Found ${trades.length.toLocaleString()} trades`);

  // Step 2: Get resolutions
  console.log('\nStep 2: Fetching resolutions...');
  const resolutionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        toInt32OrZero(arrayElement(
          splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')),
          1
        )) as outcome_0_payout,
        toInt32OrZero(arrayElement(
          splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')),
          2
        )) as outcome_1_payout,
        toInt32OrZero(payout_denominator) as payout_denom
      FROM pm_condition_resolutions
      WHERE payout_denominator != ''
        AND payout_denominator != '0'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });

  const resolutionsRaw: any[] = await resolutionsQuery.json();
  const resolutions = new Map<string, Resolution>();

  for (const r of resolutionsRaw) {
    const winningOutcome = r.outcome_0_payout > 0 ? 0 : (r.outcome_1_payout > 0 ? 1 : -1);
    resolutions.set(r.condition_id, {
      condition_id: r.condition_id,
      winning_outcome: winningOutcome,
      payout_numerators: [r.outcome_0_payout, r.outcome_1_payout],
      payout_denominator: r.payout_denom
    });
  }
  console.log(`   Found ${resolutions.size.toLocaleString()} resolved markets`);

  // Step 3: Calculate WAC-based PnL
  console.log('\nStep 3: Calculating WAC-based PnL...');

  // Position tracking: condition_id:outcome_index -> Position
  const positions = new Map<string, Position>();

  let totalTradingPnl = 0;
  let buyCount = 0;
  let sellCount = 0;

  for (const trade of trades) {
    const posKey = `${trade.condition_id}:${trade.outcome_index}`;

    // Get or create position
    let pos = positions.get(posKey);
    if (!pos) {
      pos = {
        amount: 0,
        avgPrice: 0,
        realizedPnl: 0,
        totalBought: 0,
        totalSold: 0
      };
      positions.set(posKey, pos);
    }

    const tokenAmount = trade.token_amount;
    const usdcAmount = trade.usdc_amount;

    // Calculate effective price (USDC per token)
    const effectivePrice = tokenAmount > 0 ? usdcAmount / tokenAmount : 0;

    if (trade.side === 'buy') {
      buyCount++;
      // Update WAC: avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
      if (pos.amount + tokenAmount > 0) {
        pos.avgPrice = (pos.avgPrice * pos.amount + effectivePrice * tokenAmount) / (pos.amount + tokenAmount);
      }
      pos.amount += tokenAmount;
      pos.totalBought += tokenAmount;

    } else if (trade.side === 'sell') {
      sellCount++;
      // Realized PnL = sell_amount * (sell_price - avgPrice)
      const sellPnl = tokenAmount * (effectivePrice - pos.avgPrice);
      pos.realizedPnl += sellPnl;
      totalTradingPnl += sellPnl;

      pos.amount -= tokenAmount;
      pos.totalSold += tokenAmount;

      // Note: avgPrice does NOT change on sells (per Polymarket methodology)
    }
  }

  console.log(`   Processed ${buyCount.toLocaleString()} buys, ${sellCount.toLocaleString()} sells`);
  console.log(`   Trading PnL (all sells): $${totalTradingPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  // Step 4: Calculate resolution payouts for remaining positions
  console.log('\nStep 4: Calculating resolution payouts...');

  let totalResolutionPnl = 0;
  let resolvedPositions = 0;
  let unresolvedPositions = 0;
  let unresolvedValue = 0;

  // Debug: track detailed breakdown
  let totalPayoutReceived = 0;
  let totalCostBasis = 0;

  for (const [posKey, pos] of positions) {
    if (pos.amount <= 0.001) continue; // Skip tiny/zero positions

    const [conditionId, outcomeIndexStr] = posKey.split(':');
    const outcomeIndex = parseInt(outcomeIndexStr);

    const resolution = resolutions.get(conditionId);

    if (resolution) {
      resolvedPositions++;
      // Calculate payout
      const numerator = resolution.payout_numerators[outcomeIndex] || 0;
      const payout = pos.amount * (numerator / resolution.payout_denominator);
      const costBasis = pos.amount * pos.avgPrice;

      totalPayoutReceived += payout;
      totalCostBasis += costBasis;

      // Resolution PnL = payout - cost_basis for remaining position
      const resolutionPnl = payout - costBasis;
      totalResolutionPnl += resolutionPnl;

    } else {
      unresolvedPositions++;
      // Track unrealized value at cost basis
      unresolvedValue += pos.amount * pos.avgPrice;
    }
  }

  console.log(`   DEBUG: Total payout received: $${totalPayoutReceived.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`   DEBUG: Total cost basis: $${totalCostBasis.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`   DEBUG: Payout - Cost = $${(totalPayoutReceived - totalCostBasis).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)

  console.log(`   Resolved positions: ${resolvedPositions.toLocaleString()}`);
  console.log(`   Unresolved positions: ${unresolvedPositions.toLocaleString()} ($${unresolvedValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} at cost basis)`);
  console.log(`   Resolution PnL: $${totalResolutionPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  // Step 5: Calculate totals
  const totalRealizedPnl = totalTradingPnl + totalResolutionPnl;

  // For unrealized PnL, assume unresolved positions are worth their cost basis (conservative)
  // A more accurate approach would be to look up current market prices
  // The UI might show $1 per token for held positions
  const unrealizedPnlAtPar = unresolvedValue; // If tokens are worth $1 each, profit = position value at cost

  console.log('\n' + '─'.repeat(60));
  console.log(`\n📈 TOTAL PnL for ${label}:`);
  console.log(`   Trading PnL (all sells):     $${totalTradingPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`   Resolution PnL (payouts):    $${totalResolutionPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`   ────────────────────────────────────`);
  console.log(`   TOTAL REALIZED PnL:          $${totalRealizedPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`   Unrealized (unresolved):     $${unresolvedValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} at cost`);
  console.log(`   ────────────────────────────────────`);
  console.log(`   REALIZED + UNREALIZED:       $${(totalRealizedPnl + unresolvedValue).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`);

  const totalPnl = totalRealizedPnl;

  return {
    wallet,
    label,
    tradingPnl: totalTradingPnl,
    resolutionPnl: totalResolutionPnl,
    totalPnl,
    unresolvedValue,
    tradeCount: trades.length,
    buyCount,
    sellCount,
    resolvedPositions,
    unresolvedPositions
  };
}

async function main() {
  console.log('\n🔧 WAC-Based PnL Calculator v1');
  console.log('Based on Polymarket/PaulieB14 methodology');
  console.log('─'.repeat(50));

  try {
    // Calculate for both test wallets
    const eggResult = await buildWACPnL(EGG, 'EGG');
    const whaleResult = await buildWACPnL(WHALE, 'WHALE');

    // Summary comparison
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 SUMMARY COMPARISON');
    console.log('─'.repeat(60));
    console.log('\n                     EGG              WHALE');
    console.log('─'.repeat(60));
    console.log(`Trading PnL:        $${eggResult.tradingPnl.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}).padStart(12)}   $${whaleResult.tradingPnl.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}).padStart(12)}`);
    console.log(`Resolution PnL:     $${eggResult.resolutionPnl.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}).padStart(12)}   $${whaleResult.resolutionPnl.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}).padStart(12)}`);
    console.log(`TOTAL PnL:          $${eggResult.totalPnl.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}).padStart(12)}   $${whaleResult.totalPnl.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}).padStart(12)}`);
    console.log('─'.repeat(60));
    console.log(`UI shows:           ~$96K            ~$9.5M`);
    console.log('');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
