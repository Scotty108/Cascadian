#!/usr/bin/env npx tsx
/**
 * Synthetic Realized PnL Engine
 *
 * Calculates PnL to match UI "Net total" by combining:
 * 1. CLOB trades (fill_key deduped) - avg-cost long-only realized
 * 2. Settlement PnL for resolved markets (synthetic realized)
 *
 * Open positions in unresolved markets are tracked but NOT included in realized.
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

const COLLATERAL_SCALE = 1_000_000n;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Trade {
  condition_id: string;
  outcome_index: number;
  token_id: string;
  trade_time: string;
  side: string;
  token_amount: bigint;
  usdc_amount: bigint;
}

interface Position {
  amount: bigint;
  avgPrice: bigint;
  totalCost: bigint;
  realizedPnl: bigint;
}

interface Resolution {
  condition_id: string;
  payout_numerators: number[];
  payout_denominator: number;
  resolved_at: string;
}

interface WalletResult {
  wallet: string;
  // From CLOB trades
  trading_realized_pnl: number;
  // From resolved market settlements
  settlement_pnl: number;
  // Combined (this should match UI "Net total")
  total_realized_pnl: number;
  // Tracking
  total_gain: number;
  total_loss: number;
  // Open positions (for flagging)
  open_position_count: number;
  open_position_value: number;
  // Counts
  trade_count: number;
  resolved_positions: number;
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

let resolutionCache: Map<string, Resolution> | null = null;

async function loadResolutions(): Promise<Map<string, Resolution>> {
  if (resolutionCache) return resolutionCache;

  const q = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators, payout_denominator, resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });

  const rows = await q.json() as any[];
  const cache = new Map<string, Resolution>();

  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    cache.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id,
      payout_numerators: payouts,
      payout_denominator: Number(r.payout_denominator) || 1,
      resolved_at: r.resolved_at,
    });
  }

  resolutionCache = cache;
  console.log('Loaded ' + cache.size + ' market resolutions');
  return cache;
}

// -----------------------------------------------------------------------------
// Trade Loading (fill_key deduped)
// -----------------------------------------------------------------------------

async function loadWalletTrades(wallet: string): Promise<Trade[]> {
  const q = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        t.token_id,
        t.trade_time,
        t.side,
        t.token_amount,
        t.usdc_amount
      FROM (
        SELECT
          token_id,
          any(trade_time) as trade_time,
          side,
          usdc_amount,
          token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY transaction_hash, lower(trader_wallet), token_id, side, usdc_amount, token_amount
      ) t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      ORDER BY m.condition_id, m.outcome_index, t.trade_time
    `,
    format: 'JSONEachRow'
  });

  const rows = await q.json() as any[];

  return rows
    .filter(r => r.condition_id) // Skip unmapped tokens
    .map(r => ({
      condition_id: r.condition_id.toLowerCase(),
      outcome_index: Number(r.outcome_index),
      token_id: r.token_id,
      trade_time: r.trade_time,
      side: r.side,
      token_amount: BigInt(Math.round(Number(r.token_amount))),
      usdc_amount: BigInt(Math.round(Number(r.usdc_amount))),
    }));
}

// -----------------------------------------------------------------------------
// PnL Calculation
// -----------------------------------------------------------------------------

function calculatePrice(usdc: bigint, tokens: bigint): bigint {
  if (tokens === 0n) return 0n;
  return (usdc * COLLATERAL_SCALE) / tokens;
}

async function calculateWalletPnl(wallet: string): Promise<WalletResult> {
  const resolutions = await loadResolutions();
  const trades = await loadWalletTrades(wallet);

  // Group by (condition_id, outcome_index)
  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const key = `${trade.condition_id}_${trade.outcome_index}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { amount: 0n, avgPrice: 0n, totalCost: 0n, realizedPnl: 0n };
      positions.set(key, pos);
    }

    const price = calculatePrice(trade.usdc_amount, trade.token_amount);

    if (trade.side === 'buy') {
      // Update weighted average price
      if (pos.amount === 0n) {
        pos.avgPrice = price;
      } else if (trade.token_amount > 0n) {
        pos.avgPrice = (pos.avgPrice * pos.amount + price * trade.token_amount) / (pos.amount + trade.token_amount);
      }
      pos.amount += trade.token_amount;
      pos.totalCost += trade.usdc_amount;
    } else {
      // Sell: cap at position size (sell-capping)
      const adjusted = trade.token_amount > pos.amount ? pos.amount : trade.token_amount;
      if (adjusted > 0n) {
        const delta = (adjusted * (price - pos.avgPrice)) / COLLATERAL_SCALE;
        pos.realizedPnl += delta;
        pos.amount -= adjusted;
        pos.totalCost -= (adjusted * pos.avgPrice) / COLLATERAL_SCALE;
      }
    }
  }

  // Now apply settlement for resolved markets
  let tradingRealized = 0n;
  let settlementPnl = 0n;
  let totalGain = 0n;
  let totalLoss = 0n;
  let openPositionCount = 0;
  let openPositionValue = 0n;
  let resolvedPositions = 0;

  for (const [key, pos] of positions.entries()) {
    // Add trading realized PnL
    tradingRealized += pos.realizedPnl;
    if (pos.realizedPnl > 0n) totalGain += pos.realizedPnl;
    else totalLoss += pos.realizedPnl;

    // Check for remaining LONG position only (skip shorts/negatives)
    if (pos.amount > 1000n) { // > 0.001 tokens (must be positive/long)
      const [conditionId, outcomeStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeStr, 10);
      const resolution = resolutions.get(conditionId);

      if (resolution && resolution.payout_numerators.length > outcomeIndex) {
        // Market is resolved - calculate settlement
        const payoutNum = resolution.payout_numerators[outcomeIndex];
        const payoutDen = resolution.payout_denominator;
        const payoutPrice = BigInt(Math.round((payoutNum / payoutDen) * 1e6));

        // Settlement = remaining_shares * (payout_price - avg_cost)
        const settlement = (pos.amount * (payoutPrice - pos.avgPrice)) / COLLATERAL_SCALE;
        settlementPnl += settlement;
        resolvedPositions++;

        if (settlement > 0n) totalGain += settlement;
        else totalLoss += settlement;
      } else {
        // Market NOT resolved - track as open position
        openPositionCount++;
        // Estimate value at avg cost (no market price available)
        openPositionValue += (pos.amount * pos.avgPrice) / COLLATERAL_SCALE;
      }
    }
  }

  // NOTE: UI "Net total" appears to be CLOB trading realized only
  // Settlement shows in position values, not in Net total tooltip
  // For UI matching, use trading only. Set flag for settlement impact.
  const totalRealized = tradingRealized; // Don't add settlement for UI match
  const totalWithSettlement = tradingRealized + settlementPnl;

  return {
    wallet,
    trading_realized_pnl: Number(tradingRealized) / 1e6,
    settlement_pnl: Number(settlementPnl) / 1e6,
    total_realized_pnl: Number(totalRealized) / 1e6,
    total_gain: Number(totalGain) / 1e6,
    total_loss: Number(totalLoss) / 1e6,
    open_position_count: openPositionCount,
    open_position_value: Number(openPositionValue) / 1e6,
    trade_count: trades.length,
    resolved_positions: resolvedPositions,
  };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const wallet = process.argv[2];

  if (!wallet) {
    console.log('Usage: npx tsx synthetic-realized-engine.ts <wallet>');
    console.log('       npx tsx synthetic-realized-engine.ts --benchmark');
    process.exit(1);
  }

  if (wallet === '--benchmark') {
    // Run against benchmark wallets
    const benchQ = await clickhouse.query({
      query: `
        SELECT wallet, pnl_value
        FROM pm_ui_pnl_benchmarks_v1
        WHERE abs(pnl_value) < 10000 AND pnl_value != 0
        LIMIT 30
      `,
      format: 'JSONEachRow'
    });
    const benchmarks = await benchQ.json() as Array<{ wallet: string; pnl_value: number }>;

    console.log('='.repeat(120));
    console.log('SYNTHETIC REALIZED PNL ENGINE - BENCHMARK VALIDATION');
    console.log('='.repeat(120));
    console.log('Wallet                                     | Trades | Trading   | Settlement | Total     | UI Target | Delta     | Open | Status');
    console.log('-'.repeat(120));

    let passed = 0;
    let failed = 0;

    for (const b of benchmarks) {
      const result = await calculateWalletPnl(b.wallet);
      const delta = result.total_realized_pnl - b.pnl_value;
      const deltaPercent = Math.abs(b.pnl_value) > 0 ? Math.abs(delta / b.pnl_value) * 100 : 0;

      // Pass if within 20% or $50 absolute
      const isPass = deltaPercent <= 20 || Math.abs(delta) <= 50;
      if (isPass) passed++;
      else failed++;

      const status = isPass ? '✅' : '❌';
      const openFlag = result.open_position_count > 0 ? '⚠️' + result.open_position_count : '';

      console.log(
        b.wallet.slice(0, 42) + ' | ' +
        String(result.trade_count).padStart(6) + ' | ' +
        ('$' + result.trading_realized_pnl.toFixed(0)).padStart(9) + ' | ' +
        ('$' + result.settlement_pnl.toFixed(0)).padStart(10) + ' | ' +
        ('$' + result.total_realized_pnl.toFixed(0)).padStart(9) + ' | ' +
        ('$' + b.pnl_value.toFixed(0)).padStart(9) + ' | ' +
        ('$' + delta.toFixed(0)).padStart(9) + ' | ' +
        openFlag.padStart(4) + ' | ' +
        status
      );
    }

    console.log('-'.repeat(120));
    console.log('RESULT: ' + passed + '/' + (passed + failed) + ' (' + ((passed / (passed + failed)) * 100).toFixed(1) + '%) within tolerance');
    console.log('Tolerance: 20% or $50 absolute');

  } else {
    // Single wallet
    const result = await calculateWalletPnl(wallet);

    // Get benchmark if exists
    const benchQ = await clickhouse.query({
      query: `SELECT pnl_value FROM pm_ui_pnl_benchmarks_v1 WHERE lower(wallet) = lower('${wallet}') LIMIT 1`,
      format: 'JSONEachRow'
    });
    const bench = await benchQ.json() as Array<{ pnl_value: number }>;
    const uiPnl = bench.length > 0 ? bench[0].pnl_value : null;

    console.log('='.repeat(80));
    console.log('SYNTHETIC REALIZED PNL ENGINE');
    console.log('Wallet: ' + wallet);
    console.log('='.repeat(80));
    console.log('\nRESULTS:');
    console.log('  Trading Realized:    $' + result.trading_realized_pnl.toFixed(2));
    console.log('  Settlement PnL:      $' + result.settlement_pnl.toFixed(2));
    console.log('  ---');
    console.log('  TOTAL REALIZED:      $' + result.total_realized_pnl.toFixed(2));
    console.log('\n  Gain:                $' + result.total_gain.toFixed(2));
    console.log('  Loss:                $' + result.total_loss.toFixed(2));
    console.log('\nCOUNTS:');
    console.log('  Trades:              ' + result.trade_count);
    console.log('  Resolved positions:  ' + result.resolved_positions);
    console.log('  Open positions:      ' + result.open_position_count);
    console.log('  Open value (est):    $' + result.open_position_value.toFixed(2));

    if (uiPnl !== null) {
      const delta = result.total_realized_pnl - uiPnl;
      const deltaPercent = Math.abs(uiPnl) > 0 ? (delta / Math.abs(uiPnl)) * 100 : 0;
      console.log('\n' + '='.repeat(80));
      console.log('COMPARISON TO UI:');
      console.log('  Our Total:   $' + result.total_realized_pnl.toFixed(2));
      console.log('  UI Target:   $' + uiPnl.toFixed(2));
      console.log('  Delta:       $' + delta.toFixed(2) + ' (' + deltaPercent.toFixed(1) + '%)');
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
