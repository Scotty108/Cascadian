#!/usr/bin/env npx tsx
/**
 * Subgraph-Exact Realized PnL Engine
 *
 * Replicates EXACTLY the Polymarket subgraph behavior:
 * - updateUserPositionWithBuy.ts
 * - updateUserPositionWithSell.ts
 *
 * Uses integer math (bigint) to match truncation/rounding behavior.
 *
 * Source: https://github.com/Polymarket/polymarket-subgraph/tree/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph/src/utils
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Polymarket uses 1e6 scale for USDC (6 decimals)
const COLLATERAL_SCALE = 1_000_000n;

interface Trade {
  trade_time: string;
  transaction_hash: string;
  token_id: string;
  side: string;
  token_amount: bigint;  // Raw from DB (already scaled by 1e6 in token terms)
  usdc_amount: bigint;   // Raw from DB (already scaled by 1e6)
}

interface UserPosition {
  amount: bigint;       // Token amount (scaled)
  avgPrice: bigint;     // Average price in USDC per token (scaled by COLLATERAL_SCALE)
  realizedPnl: bigint;  // Realized PnL in USDC (scaled)
}

/**
 * Exactly replicates updateUserPositionWithBuy
 *
 * avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
 * amount += buyAmount
 */
function handleBuy(position: UserPosition, price: bigint, amount: bigint): void {
  if (amount <= 0n) return;

  if (position.amount === 0n) {
    position.avgPrice = price;
  } else {
    // numerator = avgPrice * amount + price * buyAmount
    // denominator = amount + buyAmount
    // avgPrice = numerator / denominator
    const numerator = position.avgPrice * position.amount + price * amount;
    const denominator = position.amount + amount;
    position.avgPrice = numerator / denominator;
  }

  position.amount += amount;
}

/**
 * Exactly replicates updateUserPositionWithSell
 *
 * adjustedAmount = min(sellAmount, position.amount)
 * deltaPnl = adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE
 * realizedPnl += deltaPnl
 * amount -= adjustedAmount
 */
function handleSell(position: UserPosition, price: bigint, amount: bigint): void {
  // Critical: cap at position size (sell-capping)
  const adjustedAmount = amount > position.amount ? position.amount : amount;

  if (adjustedAmount <= 0n) return;

  // deltaPnl = adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE
  // Note: This can be negative if price < avgPrice
  const deltaPnl = (adjustedAmount * (price - position.avgPrice)) / COLLATERAL_SCALE;

  position.realizedPnl += deltaPnl;
  position.amount -= adjustedAmount;
}

/**
 * Calculate price in COLLATERAL_SCALE units
 * price = usdc_amount * COLLATERAL_SCALE / token_amount
 */
function calculatePrice(usdcAmount: bigint, tokenAmount: bigint): bigint {
  if (tokenAmount === 0n) return 0n;
  return (usdcAmount * COLLATERAL_SCALE) / tokenAmount;
}

async function getWalletTrades(wallet: string): Promise<Trade[]> {
  // Get deduped trades using fill_key (tx_hash, wallet, token_id, side, usdc, tokens)
  // This handles maker+taker duplicate rows for same wallet
  const q = await clickhouse.query({
    query: `
      SELECT
        trade_time,
        transaction_hash,
        token_id,
        side,
        token_amount,
        usdc_amount
      FROM (
        SELECT
          transaction_hash,
          lower(trader_wallet) as wallet,
          token_id,
          side,
          usdc_amount,
          token_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
          AND is_deleted = 0
        GROUP BY transaction_hash, wallet, token_id, side, usdc_amount, token_amount
      )
      ORDER BY trade_time, transaction_hash, token_id
    `,
    format: 'JSONEachRow'
  });

  const rawTrades = await q.json() as any[];

  // Convert to bigint (round to handle floating point from DB)
  return rawTrades.map(t => ({
    trade_time: t.trade_time,
    transaction_hash: t.transaction_hash,
    token_id: t.token_id,
    side: t.side,
    token_amount: BigInt(Math.round(t.token_amount)),
    usdc_amount: BigInt(Math.round(t.usdc_amount))
  }));
}

function calculateSubgraphPnl(trades: Trade[], debug: boolean = false): {
  realizedPnl: bigint;
  positions: Map<string, UserPosition>;
} {
  const positions = new Map<string, UserPosition>();

  for (const trade of trades) {
    let position = positions.get(trade.token_id);
    if (!position) {
      position = { amount: 0n, avgPrice: 0n, realizedPnl: 0n };
      positions.set(trade.token_id, position);
    }

    // Calculate price = usdc / tokens (scaled)
    const price = calculatePrice(trade.usdc_amount, trade.token_amount);

    if (trade.side === 'buy') {
      if (debug) {
        const prevAmt = position.amount;
        const prevAvg = position.avgPrice;
        handleBuy(position, price, trade.token_amount);
        console.log(
          `  BUY ${Number(trade.token_amount) / 1e6} @ ${Number(price) / 1e6} → ` +
          `amt: ${Number(prevAmt) / 1e6} → ${Number(position.amount) / 1e6}, ` +
          `avgPrice: ${Number(prevAvg) / 1e6} → ${Number(position.avgPrice) / 1e6}`
        );
      } else {
        handleBuy(position, price, trade.token_amount);
      }
    } else {
      if (debug) {
        const prevAmt = position.amount;
        const prevPnl = position.realizedPnl;
        const adjustedAmt = trade.token_amount > position.amount ? position.amount : trade.token_amount;
        handleSell(position, price, trade.token_amount);
        console.log(
          `  SELL ${Number(trade.token_amount) / 1e6} (adjusted: ${Number(adjustedAmt) / 1e6}) @ ${Number(price) / 1e6} ` +
          `(avgCost: ${Number(position.avgPrice) / 1e6}) → ` +
          `PnL: ${Number(prevPnl) / 1e6} → ${Number(position.realizedPnl) / 1e6}, ` +
          `remaining: ${Number(position.amount) / 1e6}`
        );
      } else {
        handleSell(position, price, trade.token_amount);
      }
    }
  }

  // Sum realized PnL across all positions
  let totalRealizedPnl = 0n;
  for (const pos of positions.values()) {
    totalRealizedPnl += pos.realizedPnl;
  }

  return { realizedPnl: totalRealizedPnl, positions };
}

// UI values from Playwright scraping
const UI_VALUES: Record<string, number> = {
  '0xadb7696bd58f5faddf23e85776b5f68fba65c02c': -1592.95,
  '0xf9fc56e10121f20e69bb496b0b1a4b277dec4bf2': 1618.24,
  '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191': 40.42,
  '0x13cb83542f2e821b117606aef235a7c6cb7e4ad1': 8.72,
  '0x46e669b5f53bfa7d8ff438a228dd06159ec0a3a1': -4.77,
  '0x88cee1fe5e14407927029b6cff5ad0fc4613d70e': -67.54,
  '0x1e8d211976903f2f5bc4e7908fcbafe07b3e4bd2': 4160.93,
};

async function main() {
  const targetWallet = process.argv[2];

  console.log('='.repeat(80));
  console.log('SUBGRAPH-EXACT REALIZED PNL ENGINE');
  console.log('Replicates Polymarket subgraph: avg-cost long-only with sell-capping');
  console.log('Uses integer math (bigint) for exact truncation/rounding');
  console.log('='.repeat(80));
  console.log();

  if (targetWallet) {
    // Single wallet with debug
    console.log(`Processing wallet: ${targetWallet}\n`);

    const trades = await getWalletTrades(targetWallet);
    console.log(`Found ${trades.length} trades\n`);

    // Group by token for debug output
    const byToken = new Map<string, Trade[]>();
    for (const t of trades) {
      if (!byToken.has(t.token_id)) byToken.set(t.token_id, []);
      byToken.get(t.token_id)!.push(t);
    }

    let totalPnl = 0n;
    for (const [tokenId, tokenTrades] of byToken.entries()) {
      console.log(`--- Token ${tokenId.slice(0, 20)}... ---`);
      const result = calculateSubgraphPnl(tokenTrades, true);
      const tokenPnl = Array.from(result.positions.values())[0]?.realizedPnl || 0n;
      totalPnl += tokenPnl;
      console.log(`  Token realized PnL: $${(Number(tokenPnl) / 1e6).toFixed(2)}\n`);
    }

    const uiTarget = UI_VALUES[targetWallet.toLowerCase()] || 0;
    const calculatedPnl = Number(totalPnl) / 1e6;

    console.log('='.repeat(80));
    console.log('RESULT');
    console.log('='.repeat(80));
    console.log(`Subgraph-Exact PnL: $${calculatedPnl.toFixed(2)}`);
    console.log(`UI Target:          $${uiTarget.toFixed(2)}`);
    console.log(`Delta:              $${(calculatedPnl - uiTarget).toFixed(2)}`);
  } else {
    // All 7 wallets
    console.log('Testing all 7 regression wallets...\n');
    console.log('Wallet            | Subgraph PnL   | UI Target    | Delta        | Status');
    console.log('-'.repeat(85));

    let passed = 0;
    let failed = 0;

    for (const [wallet, uiTarget] of Object.entries(UI_VALUES)) {
      const trades = await getWalletTrades(wallet);

      if (trades.length === 0) {
        console.log(`${wallet.slice(0, 16)}... | [NO TRADES]`);
        failed++;
        continue;
      }

      const result = calculateSubgraphPnl(trades);
      const calculatedPnl = Number(result.realizedPnl) / 1e6;
      const delta = calculatedPnl - uiTarget;

      const threshold = Math.abs(uiTarget) > 500 ? 50 : 15;
      const isPass = Math.abs(delta) <= threshold;

      if (isPass) passed++;
      else failed++;

      const status = isPass ? '✅ PASS' : '❌ FAIL';

      console.log(
        `${wallet.slice(0, 16)}... | ` +
        `$${calculatedPnl.toFixed(2).padStart(12)} | ` +
        `$${uiTarget.toFixed(2).padStart(10)} | ` +
        `$${delta.toFixed(2).padStart(10)} | ` +
        status
      );
    }

    console.log('-'.repeat(85));
    console.log(`\nSUMMARY: ${passed}/${passed + failed} wallets within tolerance`);
    console.log('Tolerance: $15 for small PnL (<$500), $50 for large PnL');
  }

  await clickhouse.close();
}

main().catch(console.error);
