#!/usr/bin/env npx tsx
/**
 * Average Cost Long-Only Realized PnL Engine
 *
 * Based on actual Polymarket subgraph code:
 * https://github.com/Polymarket/polymarket-subgraph/blob/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph/src/utils/updateUserPositionWithSell.ts
 *
 * Key rules:
 * - Track position amount and avgPrice per token
 * - On BUY: update avgPrice = (old_amount * old_avgPrice + buy_amount * buy_price) / (old_amount + buy_amount)
 * - On SELL: realizedPnl += min(sell_amount, position_amount) * (sell_price - avgPrice)
 * - Sells beyond position size are IGNORED (user obtained tokens outside tracking)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

interface Trade {
  trade_time: string;
  token_id: string;
  side: string;
  shares: number;
  usdc: number;
}

interface UserPosition {
  amount: number;      // Current position size
  avgPrice: number;    // Weighted average price
  realizedPnl: number; // Accumulated realized PnL
}

function calculateAvgCostLongOnly(trades: Trade[], debug: boolean = false): {
  realizedPnl: number;
  finalPosition: UserPosition;
} {
  const position: UserPosition = {
    amount: 0,
    avgPrice: 0,
    realizedPnl: 0
  };

  for (const t of trades) {
    const price = t.usdc / t.shares;

    if (t.side === 'buy') {
      // Update avgPrice using weighted average
      if (position.amount === 0) {
        position.avgPrice = price;
      } else {
        position.avgPrice = (position.amount * position.avgPrice + t.shares * price) / (position.amount + t.shares);
      }
      position.amount += t.shares;

      if (debug) {
        console.log(`  BUY ${t.shares.toFixed(2)} @ $${price.toFixed(4)} → amt=${position.amount.toFixed(2)}, avgPrice=$${position.avgPrice.toFixed(4)}`);
      }
    } else {
      // SELL: cap at position size (Polymarket subgraph behavior)
      const adjustedAmount = Math.min(t.shares, position.amount);

      if (adjustedAmount > 0) {
        // deltaPnL = adjustedAmount * (sellPrice - avgPrice)
        const deltaPnL = adjustedAmount * (price - position.avgPrice);
        position.realizedPnl += deltaPnL;
        position.amount -= adjustedAmount;

        if (debug) {
          console.log(`  SELL ${adjustedAmount.toFixed(2)} @ $${price.toFixed(4)} (avgCost=$${position.avgPrice.toFixed(4)}) → PnL $${deltaPnL.toFixed(2)}, remaining=${position.amount.toFixed(2)}`);
        }
      }

      // Extra shares beyond position are IGNORED
      const ignoredShares = t.shares - adjustedAmount;
      if (ignoredShares > 0 && debug) {
        console.log(`    [IGNORED: ${ignoredShares.toFixed(2)} shares sold beyond position - tokens obtained outside tracking]`);
      }
    }
  }

  return {
    realizedPnl: position.realizedPnl,
    finalPosition: position
  };
}

// UI values from Playwright scraping (captured 2025-12-13)
const UI_VALUES: Record<string, { net_total: number; gain?: number; loss?: number }> = {
  '0xadb7696bd58f5faddf23e85776b5f68fba65c02c': { net_total: -1592.95 },
  '0xf9fc56e10121f20e69bb496b0b1a4b277dec4bf2': { net_total: 1618.24 },
  '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191': { net_total: 40.42, gain: 697.55, loss: -657.12 },
  '0x13cb83542f2e821b117606aef235a7c6cb7e4ad1': { net_total: 8.72 },
  '0x46e669b5f53bfa7d8ff438a228dd06159ec0a3a1': { net_total: -4.77, gain: 7.27, loss: -12.03 },
  '0x88cee1fe5e14407927029b6cff5ad0fc4613d70e': { net_total: -67.54, gain: 49.27, loss: -116.81 },
  '0x1e8d211976903f2f5bc4e7908fcbafe07b3e4bd2': { net_total: 4160.93 },
};

async function calculateWalletPnl(wallet: string, debug: boolean = false): Promise<{
  wallet: string;
  avgCostLongOnly: number;
  uiTarget: number;
  delta: number;
  tokenCount: number;
}> {
  // Get all trades for this wallet
  const q = await clickhouse.query({
    query: `
      SELECT
        trade_time,
        token_id,
        side,
        token_amount / 1e6 as shares,
        usdc_amount / 1e6 as usdc
      FROM pm_trader_fills_dedup_v1
      WHERE trader_wallet = '${wallet}'
      ORDER BY token_id, trade_time
    `,
    format: 'JSONEachRow'
  });
  const allTrades = await q.json() as Trade[];

  // Group by token
  const byToken = new Map<string, Trade[]>();
  for (const t of allTrades) {
    if (!byToken.has(t.token_id)) byToken.set(t.token_id, []);
    byToken.get(t.token_id)!.push(t);
  }

  // Calculate per token
  let totalPnl = 0;

  for (const [tokenId, trades] of byToken.entries()) {
    if (debug) console.log(`\n--- Token ${tokenId.slice(0, 16)}... ---`);
    const result = calculateAvgCostLongOnly(trades, debug);
    totalPnl += result.realizedPnl;
    if (debug) console.log(`  Token PnL: $${result.realizedPnl.toFixed(2)}, Open: ${result.finalPosition.amount.toFixed(2)} shares`);
  }

  const uiTarget = UI_VALUES[wallet]?.net_total || 0;

  return {
    wallet,
    avgCostLongOnly: totalPnl,
    uiTarget,
    delta: totalPnl - uiTarget,
    tokenCount: byToken.size
  };
}

async function main() {
  const targetWallet = process.argv[2];

  console.log('='.repeat(80));
  console.log('AVERAGE COST LONG-ONLY REALIZED PNL ENGINE');
  console.log('Based on Polymarket subgraph: updateUserPositionWithSell.ts');
  console.log('='.repeat(80));
  console.log('Formula: deltaPnL = min(sellAmt, positionAmt) × (sellPrice - avgPrice)');
  console.log();

  if (targetWallet) {
    // Single wallet mode with debug
    const result = await calculateWalletPnl(targetWallet, true);
    console.log('\n' + '='.repeat(80));
    console.log('RESULT');
    console.log('='.repeat(80));
    console.log(`Avg-Cost Long-Only: $${result.avgCostLongOnly.toFixed(2)}`);
    console.log(`UI Target:          $${result.uiTarget.toFixed(2)}`);
    console.log(`Delta:              $${result.delta.toFixed(2)}`);
  } else {
    // All 7 wallets
    console.log('Testing all 7 regression wallets...\n');
    console.log('Wallet (10 chars) | Avg-Cost L-O   | UI Target   | Delta       | Status');
    console.log('-'.repeat(80));

    let passed = 0;
    let failed = 0;

    for (const wallet of Object.keys(UI_VALUES)) {
      const result = await calculateWalletPnl(wallet);
      const threshold = Math.abs(result.uiTarget) > 500 ? 50 : 15;
      const isPass = Math.abs(result.delta) <= threshold;

      if (isPass) passed++;
      else failed++;

      const status = isPass ? '✅ PASS' : '❌ FAIL';

      console.log(
        wallet.slice(0, 10).padEnd(17) + ' | ' +
        `$${result.avgCostLongOnly.toFixed(2)}`.padStart(14) + ' | ' +
        `$${result.uiTarget.toFixed(2)}`.padStart(11) + ' | ' +
        `$${result.delta.toFixed(2)}`.padStart(11) + ' | ' +
        status
      );
    }

    console.log('-'.repeat(80));
    console.log(`SUMMARY: ${passed}/${passed + failed} wallets within tolerance`);
    console.log('\nNote: Tolerance is $15 for small PnL (<$500), $50 for large PnL');
  }

  await clickhouse.close();
}

main().catch(console.error);
