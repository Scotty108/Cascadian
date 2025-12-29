#!/usr/bin/env npx tsx
/**
 * Benchmark Validation - Test FIFO vs Avg-Cost against UI benchmarks
 *
 * Tests both methods against pm_ui_pnl_benchmarks_v1 data
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

interface Trade {
  token_id: string;
  side: string;
  shares: number;
  usdc: number;
}

// FIFO Long-Only
function calculateFifoLongOnly(trades: Trade[]): number {
  const longLots: Array<{ shares: number; price: number }> = [];
  let realizedPnl = 0;

  for (const t of trades) {
    const price = t.usdc / t.shares;

    if (t.side === 'buy') {
      longLots.push({ shares: t.shares, price });
    } else {
      let sharesToSell = t.shares;
      while (sharesToSell > 0 && longLots.length > 0) {
        const oldest = longLots[0];
        const sellFromThis = Math.min(sharesToSell, oldest.shares);
        realizedPnl += sellFromThis * (price - oldest.price);
        oldest.shares -= sellFromThis;
        sharesToSell -= sellFromThis;
        if (oldest.shares <= 0) longLots.shift();
      }
    }
  }

  return realizedPnl;
}

// Avg-Cost Long-Only (Polymarket subgraph style)
function calculateAvgCostLongOnly(trades: Trade[]): number {
  let amount = 0;
  let avgPrice = 0;
  let realizedPnl = 0;

  for (const t of trades) {
    const price = t.usdc / t.shares;

    if (t.side === 'buy') {
      if (amount === 0) {
        avgPrice = price;
      } else {
        avgPrice = (amount * avgPrice + t.shares * price) / (amount + t.shares);
      }
      amount += t.shares;
    } else {
      const adjustedAmount = Math.min(t.shares, amount);
      if (adjustedAmount > 0) {
        realizedPnl += adjustedAmount * (price - avgPrice);
        amount -= adjustedAmount;
      }
    }
  }

  return realizedPnl;
}

async function getWalletTrades(wallet: string): Promise<Trade[]> {
  // Get deduped trades using fill_key
  const q = await clickhouse.query({
    query: `
      SELECT
        token_id,
        side,
        token_amount / 1e6 as shares,
        usdc_amount / 1e6 as usdc
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
      ORDER BY token_id, trade_time
    `,
    format: 'JSONEachRow'
  });

  return await q.json() as Trade[];
}

async function calculateWalletPnl(wallet: string): Promise<{
  fifo: number;
  avgCost: number;
  tradeCount: number;
}> {
  const trades = await getWalletTrades(wallet);

  if (trades.length === 0) {
    return { fifo: 0, avgCost: 0, tradeCount: 0 };
  }

  // Group by token
  const byToken = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!byToken.has(t.token_id)) byToken.set(t.token_id, []);
    byToken.get(t.token_id)!.push(t);
  }

  let fifoTotal = 0;
  let avgCostTotal = 0;

  for (const tokenTrades of byToken.values()) {
    fifoTotal += calculateFifoLongOnly(tokenTrades);
    avgCostTotal += calculateAvgCostLongOnly(tokenTrades);
  }

  return {
    fifo: fifoTotal,
    avgCost: avgCostTotal,
    tradeCount: trades.length
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('BENCHMARK VALIDATION: FIFO vs AVG-COST');
  console.log('Testing against pm_ui_pnl_benchmarks_v1');
  console.log('='.repeat(100));
  console.log();

  // Get benchmark wallets (sample of 20 with reasonable PnL values)
  const benchmarksQ = await clickhouse.query({
    query: `
      SELECT wallet, pnl_value, note
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = '50_wallet_v1_legacy'
        AND abs(pnl_value) < 10000
        AND pnl_value != 0
      ORDER BY rand()
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });
  const benchmarks = await benchmarksQ.json() as Array<{ wallet: string; pnl_value: number; note: string }>;

  console.log(`Testing ${benchmarks.length} benchmark wallets...\n`);
  console.log('Wallet            | Trades | FIFO         | Avg-Cost     | UI Target    | FIFO Δ       | AvgC Δ');
  console.log('-'.repeat(110));

  let fifoWins = 0;
  let avgCostWins = 0;
  let ties = 0;
  let fifoPass = 0;
  let avgCostPass = 0;

  for (const b of benchmarks) {
    const result = await calculateWalletPnl(b.wallet);

    if (result.tradeCount === 0) {
      console.log(`${b.wallet.slice(0, 16)}... | ${String(0).padStart(6)} | [NO TRADES IN DATA]`);
      continue;
    }

    const fifoDelta = result.fifo - b.pnl_value;
    const avgCostDelta = result.avgCost - b.pnl_value;

    const threshold = Math.abs(b.pnl_value) > 500 ? Math.abs(b.pnl_value) * 0.15 : 50;
    const fifoIsPass = Math.abs(fifoDelta) <= threshold;
    const avgCostIsPass = Math.abs(avgCostDelta) <= threshold;

    if (fifoIsPass) fifoPass++;
    if (avgCostIsPass) avgCostPass++;

    const fifoAbsDelta = Math.abs(fifoDelta);
    const avgCostAbsDelta = Math.abs(avgCostDelta);

    if (fifoAbsDelta < avgCostAbsDelta - 1) {
      fifoWins++;
    } else if (avgCostAbsDelta < fifoAbsDelta - 1) {
      avgCostWins++;
    } else {
      ties++;
    }

    const fifoStatus = fifoIsPass ? '✓' : '';
    const avgStatus = avgCostIsPass ? '✓' : '';

    console.log(
      `${b.wallet.slice(0, 16)}... | ${String(result.tradeCount).padStart(6)} | ` +
      `$${result.fifo.toFixed(2).padStart(10)} | ` +
      `$${result.avgCost.toFixed(2).padStart(10)} | ` +
      `$${b.pnl_value.toFixed(2).padStart(10)} | ` +
      `$${fifoDelta.toFixed(2).padStart(10)} ${fifoStatus} | ` +
      `$${avgCostDelta.toFixed(2).padStart(8)} ${avgStatus}`
    );
  }

  console.log('-'.repeat(110));
  console.log('\n=== SUMMARY ===');
  console.log(`FIFO closer:      ${fifoWins}`);
  console.log(`Avg-Cost closer:  ${avgCostWins}`);
  console.log(`Ties:             ${ties}`);
  console.log(`\nFIFO pass rate:     ${fifoPass}/${benchmarks.length}`);
  console.log(`Avg-Cost pass rate: ${avgCostPass}/${benchmarks.length}`);

  await clickhouse.close();
}

main().catch(console.error);
