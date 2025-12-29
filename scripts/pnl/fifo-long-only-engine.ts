#!/usr/bin/env npx tsx
/**
 * FIFO Long-Only Realized PnL Engine
 *
 * Key rules:
 * - Only realize PnL when SELLING from long inventory
 * - Ignore short positions entirely (short creation, short covering)
 * - Use FIFO (First-In-First-Out) for lot selection
 *
 * This matches the Polymarket UI "Net total" calculation.
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

interface LongLot {
  shares: number;
  price: number;
}

function calculateFifoLongOnly(trades: Trade[], debug: boolean = false): number {
  const longLots: LongLot[] = [];
  let realizedPnl = 0;

  for (const t of trades) {
    const price = t.usdc / t.shares;

    if (t.side === 'buy') {
      // Add to long inventory
      longLots.push({ shares: t.shares, price });
      if (debug) {
        console.log(`  BUY ${t.shares.toFixed(2)} @ $${price.toFixed(4)} → ${longLots.length} lots`);
      }
    } else {
      // SELL: close longs with FIFO
      let sharesToSell = t.shares;
      if (debug) console.log(`  SELL ${t.shares.toFixed(2)} @ $${price.toFixed(4)}:`);

      while (sharesToSell > 0 && longLots.length > 0) {
        const oldest = longLots[0];
        const sellFromThis = Math.min(sharesToSell, oldest.shares);

        const pnl = (price - oldest.price) * sellFromThis;
        realizedPnl += pnl;

        if (debug) {
          console.log(`    Close ${sellFromThis.toFixed(2)} from lot @ $${oldest.price.toFixed(4)} → PnL $${pnl.toFixed(2)}`);
        }

        oldest.shares -= sellFromThis;
        sharesToSell -= sellFromThis;

        if (oldest.shares <= 0) longLots.shift();
      }

      if (sharesToSell > 0 && debug) {
        console.log(`    [${sharesToSell.toFixed(2)} shares create short - IGNORED]`);
      }
    }
  }

  return realizedPnl;
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
  fifoLongOnly: number;
  uiTarget: number;
  delta: number;
  tokenBreakdown: Array<{ token: string; pnl: number }>;
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

  // Calculate FIFO long-only per token
  let totalPnl = 0;
  const tokenBreakdown: Array<{ token: string; pnl: number }> = [];

  for (const [tokenId, trades] of byToken.entries()) {
    if (debug) console.log(`\n--- Token ${tokenId.slice(0, 16)}... ---`);
    const pnl = calculateFifoLongOnly(trades, debug);
    totalPnl += pnl;
    tokenBreakdown.push({ token: tokenId.slice(0, 16), pnl });
    if (debug) console.log(`  Token PnL: $${pnl.toFixed(2)}`);
  }

  const uiTarget = UI_VALUES[wallet]?.net_total || 0;

  return {
    wallet,
    fifoLongOnly: totalPnl,
    uiTarget,
    delta: totalPnl - uiTarget,
    tokenBreakdown
  };
}

async function main() {
  const targetWallet = process.argv[2];

  console.log('='.repeat(80));
  console.log('FIFO LONG-ONLY REALIZED PNL ENGINE');
  console.log('='.repeat(80));
  console.log('Formula: Only realize PnL when selling from long inventory (FIFO)');
  console.log();

  if (targetWallet) {
    // Single wallet mode with debug
    const result = await calculateWalletPnl(targetWallet, true);
    console.log('\n' + '='.repeat(80));
    console.log('RESULT');
    console.log('='.repeat(80));
    console.log(`FIFO Long-Only: $${result.fifoLongOnly.toFixed(2)}`);
    console.log(`UI Target:      $${result.uiTarget.toFixed(2)}`);
    console.log(`Delta:          $${result.delta.toFixed(2)}`);
  } else {
    // All 7 wallets
    console.log('Testing all 7 regression wallets...\n');
    console.log('Wallet (10 chars) | FIFO Long-Only | UI Target   | Delta       | Status');
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
        `$${result.fifoLongOnly.toFixed(2)}`.padStart(14) + ' | ' +
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
