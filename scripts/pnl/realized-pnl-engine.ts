#!/usr/bin/env npx tsx
/**
 * Realized PnL Engine - Avg-Cost Inventory Accounting
 *
 * Key rules:
 * - Realized PnL only when position size is REDUCED
 * - Sell reduces long → realized PnL = (sale_price - avg_cost) × shares
 * - Buy reduces short → realized PnL = (avg_short_price - buy_price) × shares
 * - Open inventory does NOT contribute to realized PnL
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

interface TokenInventory {
  shares: number;        // Positive = long, negative = short
  costBasis: number;     // Total cost for longs, total proceeds for shorts
}

interface Trade {
  trade_time: string;
  token_id: string;
  side: string;
  shares: number;
  usdc: number;
}

function calculateRealizedPnl(trades: Trade[], debug: boolean = false): {
  realizedPnl: number;
  openInventory: Map<string, TokenInventory>;
  closedPositions: Array<{ token_id: string; pnl: number }>;
} {
  const inventory = new Map<string, TokenInventory>();
  const closedPositions: Array<{ token_id: string; pnl: number }> = [];
  let totalRealizedPnl = 0;

  for (const trade of trades) {
    const tokenId = trade.token_id;
    let inv = inventory.get(tokenId);
    if (!inv) {
      inv = { shares: 0, costBasis: 0 };
      inventory.set(tokenId, inv);
    }

    const priorShares = inv.shares;
    const priorCost = inv.costBasis;
    const tradeShares = trade.shares;
    const tradeUsdc = trade.usdc;

    if (trade.side === 'buy') {
      if (priorShares >= 0) {
        // Adding to long (or opening long from zero)
        // No realized PnL - just increase inventory
        inv.shares += tradeShares;
        inv.costBasis += tradeUsdc;

        if (debug) {
          console.log(`  BUY (add long): +${tradeShares.toFixed(2)} @ $${(tradeUsdc/tradeShares).toFixed(4)} | inv: ${inv.shares.toFixed(2)} shares, $${inv.costBasis.toFixed(2)} cost`);
        }
      } else {
        // Closing short position
        const sharesToClose = Math.min(tradeShares, Math.abs(priorShares));
        const avgShortPrice = priorCost / Math.abs(priorShares); // Avg proceeds per share when shorting
        const buyPrice = tradeUsdc / tradeShares;

        // Realized PnL = (avg_short_price - buy_price) × shares_closed
        // If we shorted at $0.50 and buy back at $0.30, we profit $0.20 per share
        const pnl = (avgShortPrice - buyPrice) * sharesToClose;
        totalRealizedPnl += pnl;
        closedPositions.push({ token_id: tokenId.slice(0, 20), pnl });

        // Reduce short position
        const costReduction = avgShortPrice * sharesToClose;
        inv.shares += sharesToClose;
        inv.costBasis -= costReduction;

        // If buy exceeds short, remainder creates long
        const excessShares = tradeShares - sharesToClose;
        if (excessShares > 0) {
          const excessCost = buyPrice * excessShares;
          inv.shares += excessShares;
          inv.costBasis += excessCost;
        }

        if (debug) {
          console.log(`  BUY (close short): +${sharesToClose.toFixed(2)} @ $${buyPrice.toFixed(4)} | PnL: $${pnl.toFixed(2)} | inv: ${inv.shares.toFixed(2)} shares`);
        }
      }
    } else {
      // SELL
      if (priorShares <= 0) {
        // Creating/increasing short (or opening short from zero)
        // No realized PnL - just record proceeds
        inv.shares -= tradeShares;
        inv.costBasis += tradeUsdc; // For shorts, costBasis = total proceeds received

        if (debug) {
          console.log(`  SELL (add short): -${tradeShares.toFixed(2)} @ $${(tradeUsdc/tradeShares).toFixed(4)} | inv: ${inv.shares.toFixed(2)} shares, $${inv.costBasis.toFixed(2)} proceeds`);
        }
      } else {
        // Closing long position
        const sharesToClose = Math.min(tradeShares, priorShares);
        const avgCost = priorCost / priorShares;
        const salePrice = tradeUsdc / tradeShares;

        // Realized PnL = (sale_price - avg_cost) × shares_closed
        const pnl = (salePrice - avgCost) * sharesToClose;
        totalRealizedPnl += pnl;
        closedPositions.push({ token_id: tokenId.slice(0, 20), pnl });

        // Reduce long position
        const costReduction = avgCost * sharesToClose;
        inv.shares -= sharesToClose;
        inv.costBasis -= costReduction;

        // If sell exceeds long, remainder creates short
        const excessShares = tradeShares - sharesToClose;
        if (excessShares > 0) {
          const excessProceeds = salePrice * excessShares;
          inv.shares -= excessShares;
          inv.costBasis += excessProceeds; // Short's "cost basis" is proceeds
        }

        if (debug) {
          console.log(`  SELL (close long): -${sharesToClose.toFixed(2)} @ $${salePrice.toFixed(4)} | PnL: $${pnl.toFixed(2)} | inv: ${inv.shares.toFixed(2)} shares`);
        }
      }
    }
  }

  return {
    realizedPnl: totalRealizedPnl,
    openInventory: inventory,
    closedPositions
  };
}

async function main() {
  const patapam = '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191';

  console.log('='.repeat(80));
  console.log('REALIZED PNL ENGINE - PATAPAM222 TEST');
  console.log('='.repeat(80));
  console.log('Target: UI Net total = $40.42');
  console.log();

  // Load trades from deduped table
  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        trade_time,
        token_id,
        side,
        token_amount / 1e6 as shares,
        usdc_amount / 1e6 as usdc
      FROM pm_trader_fills_dedup_v1
      WHERE trader_wallet = '${patapam}'
      ORDER BY trade_time, token_id
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQuery.json() as Trade[];

  console.log(`Loaded ${trades.length} trades\n`);

  // Group by token for easier analysis
  const byToken = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = t.token_id.slice(0, 20);
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key)!.push(t);
  }

  // Calculate realized PnL per token
  console.log('=== PER-TOKEN ANALYSIS ===\n');

  let totalRealizedPnl = 0;

  for (const [tokenKey, tokenTrades] of byToken.entries()) {
    console.log(`--- Token: ${tokenKey}... ---`);

    const result = calculateRealizedPnl(tokenTrades, true);

    const inv = result.openInventory.get(tokenTrades[0].token_id)!;
    const openShares = inv?.shares || 0;
    const openCost = inv?.costBasis || 0;

    console.log(`  RESULT: Realized PnL = $${result.realizedPnl.toFixed(2)}`);
    console.log(`  OPEN: ${openShares.toFixed(2)} shares, $${openCost.toFixed(2)} ${openShares >= 0 ? 'cost' : 'proceeds'}`);
    console.log();

    totalRealizedPnl += result.realizedPnl;
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Realized PnL:  $${totalRealizedPnl.toFixed(2)}`);
  console.log(`UI Net Total:        $40.42`);
  console.log(`Delta:               $${(totalRealizedPnl - 40.42).toFixed(2)}`);

  const threshold = 0.01;
  if (Math.abs(totalRealizedPnl - 40.42) <= threshold) {
    console.log(`\n✅ PASS: Within $${threshold} tolerance`);
  } else if (Math.abs(totalRealizedPnl - 40.42) <= 1.00) {
    console.log(`\n⚠️ CLOSE: Within $1.00 (investigate rounding)`);
  } else {
    console.log(`\n❌ FAIL: Discrepancy > $1.00`);
  }

  await clickhouse.close();
}

main().catch(console.error);
