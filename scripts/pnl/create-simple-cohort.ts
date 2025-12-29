#!/usr/bin/env npx tsx
/**
 * Create Simple Cohort for PnL Validation
 *
 * Find wallets with:
 * - Low trade count in CLOB data
 * - Small absolute PnL values (less complex flows)
 * - Matching signs between calculation and UI
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

const COLLATERAL_SCALE = 1_000_000n;

interface Trade {
  token_id: string;
  side: string;
  token_amount: bigint;
  usdc_amount: bigint;
}

function calculatePrice(usdcAmount: bigint, tokenAmount: bigint): bigint {
  if (tokenAmount === 0n) return 0n;
  return (usdcAmount * COLLATERAL_SCALE) / tokenAmount;
}

function calculateSubgraphPnl(trades: Trade[]): bigint {
  const positions = new Map<string, { amount: bigint; avgPrice: bigint; realizedPnl: bigint }>();

  for (const trade of trades) {
    let position = positions.get(trade.token_id);
    if (!position) {
      position = { amount: 0n, avgPrice: 0n, realizedPnl: 0n };
      positions.set(trade.token_id, position);
    }

    const price = calculatePrice(trade.usdc_amount, trade.token_amount);

    if (trade.side === 'buy') {
      if (position.amount === 0n) {
        position.avgPrice = price;
      } else {
        position.avgPrice = (position.avgPrice * position.amount + price * trade.token_amount) / (position.amount + trade.token_amount);
      }
      position.amount += trade.token_amount;
    } else {
      const adjustedAmount = trade.token_amount > position.amount ? position.amount : trade.token_amount;
      if (adjustedAmount > 0n) {
        position.realizedPnl += (adjustedAmount * (price - position.avgPrice)) / COLLATERAL_SCALE;
        position.amount -= adjustedAmount;
      }
    }
  }

  let total = 0n;
  for (const pos of positions.values()) {
    total += pos.realizedPnl;
  }
  return total;
}

async function main() {
  console.log('='.repeat(80));
  console.log('CREATING SIMPLE COHORT FOR PNL VALIDATION');
  console.log('='.repeat(80));
  console.log();

  // Get all benchmark wallets
  const benchmarksQ = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      WHERE abs(pnl_value) < 5000
        AND pnl_value != 0
    `,
    format: 'JSONEachRow'
  });
  const benchmarks = await benchmarksQ.json() as Array<{ wallet: string; pnl_value: number }>;

  console.log(`Found ${benchmarks.length} benchmark wallets to test\n`);

  const results: Array<{
    wallet: string;
    trades: number;
    tokens: number;
    calcPnl: number;
    uiPnl: number;
    delta: number;
    deltaPercent: number;
  }> = [];

  let processed = 0;
  for (const b of benchmarks) {
    processed++;
    if (processed % 10 === 0) {
      console.log(`Processing ${processed}/${benchmarks.length}...`);
    }

    // Get trades for this wallet directly from raw table with fill_key dedupe
    const tradesQ = await clickhouse.query({
      query: `
        SELECT
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
          WHERE lower(trader_wallet) = '${b.wallet.toLowerCase()}'
            AND is_deleted = 0
          GROUP BY transaction_hash, wallet, token_id, side, usdc_amount, token_amount
        )
        ORDER BY token_id, trade_time
      `,
      format: 'JSONEachRow'
    });
    const rawTrades = await tradesQ.json() as any[];

    if (rawTrades.length === 0) continue;

    const trades: Trade[] = rawTrades.map(t => ({
      token_id: t.token_id,
      side: t.side,
      token_amount: BigInt(Math.round(t.token_amount)),
      usdc_amount: BigInt(Math.round(t.usdc_amount))
    }));

    const calcPnl = Number(calculateSubgraphPnl(trades)) / 1e6;
    const delta = calcPnl - b.pnl_value;
    const deltaPercent = b.pnl_value !== 0 ? (delta / Math.abs(b.pnl_value)) * 100 : 0;

    const uniqueTokens = new Set(trades.map(t => t.token_id)).size;

    results.push({
      wallet: b.wallet,
      trades: trades.length,
      tokens: uniqueTokens,
      calcPnl,
      uiPnl: b.pnl_value,
      delta,
      deltaPercent
    });
  }

  // Sort by delta percentage (closest first)
  results.sort((a, b) => Math.abs(a.deltaPercent) - Math.abs(b.deltaPercent));

  console.log('\n' + '='.repeat(100));
  console.log('TOP 50 CLOSEST MATCHES (Simple Cohort Candidates)');
  console.log('='.repeat(100));
  console.log('Wallet            | Trades | Tokens | Calc PnL     | UI PnL       | Delta        | Δ%');
  console.log('-'.repeat(100));

  let passCount = 0;
  const simpleCohort: string[] = [];

  for (let i = 0; i < Math.min(50, results.length); i++) {
    const r = results[i];
    const threshold = Math.abs(r.uiPnl) > 500 ? 50 : 15;
    const isPass = Math.abs(r.delta) <= threshold;

    if (isPass) {
      passCount++;
      simpleCohort.push(r.wallet);
    }

    const status = isPass ? '✓' : '';

    console.log(
      `${r.wallet.slice(0, 16)}... | ` +
      `${String(r.trades).padStart(6)} | ` +
      `${String(r.tokens).padStart(6)} | ` +
      `$${r.calcPnl.toFixed(2).padStart(10)} | ` +
      `$${r.uiPnl.toFixed(2).padStart(10)} | ` +
      `$${r.delta.toFixed(2).padStart(10)} | ` +
      `${r.deltaPercent.toFixed(1).padStart(6)}% ${status}`
    );
  }

  console.log('-'.repeat(100));
  console.log(`\nPASSING: ${passCount}/50 in top matches`);

  // Show summary by pass/fail reason
  console.log('\n=== FAILURE ANALYSIS ===');

  const signFlips = results.filter(r => (r.calcPnl >= 0) !== (r.uiPnl >= 0)).length;
  const largeDeltas = results.filter(r => Math.abs(r.delta) > 100).length;

  console.log(`Sign flips: ${signFlips}/${results.length}`);
  console.log(`Large deltas (>$100): ${largeDeltas}/${results.length}`);

  // Output simple cohort JSON
  console.log('\n=== SIMPLE COHORT (paste into test file) ===');
  console.log('const SIMPLE_COHORT = [');
  simpleCohort.slice(0, 20).forEach(w => console.log(`  '${w}',`));
  console.log('];');

  await clickhouse.close();
}

main().catch(console.error);
