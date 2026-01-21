#!/usr/bin/env npx tsx
/**
 * Copy Trading Simulator
 *
 * Simulates equal-weight copy trading by replaying trades chronologically.
 *
 * Rules:
 * - When they BUY: I buy $1 worth
 * - When they SELL: I sell my ENTIRE position for that market
 * - Tracks concurrent capital deployed
 * - Calculates actual return on capital
 *
 * Usage: npx tsx scripts/simulate-copy-trading.ts [--wallets=0x...,0x...] [--days=30] [--top=50]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Parse args
const DAYS_BACK = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '30');
const TOP_N = parseInt(process.argv.find(a => a.startsWith('--top='))?.split('=')[1] || '50');
const STARTING_CAPITAL = parseFloat(process.argv.find(a => a.startsWith('--capital='))?.split('=')[1] || '0'); // 0 = unlimited
const SPECIFIC_WALLETS = process.argv.find(a => a.startsWith('--wallets='))?.split('=')[1]?.split(',');

interface Trade {
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  trade_time: Date;
  side: 'buy' | 'sell';
  tokens: number;
  usdc: number;
  price: number; // usdc per token
}

interface Resolution {
  condition_id: string;
  resolved_at: Date;
  payout_rate: number; // for outcome_index we care about
}

interface Position {
  condition_id: string;
  outcome_index: number;
  tokens_owned: number;  // My tokens (not theirs)
  cost_basis: number;    // My cost ($1 per buy)
  their_tokens: number;  // Their tokens (to calculate my proportional share on sell)
}

interface SimulationResult {
  wallet: string;
  total_trades: number;
  buy_count: number;
  sell_count: number;
  positions_opened: number;
  positions_closed_by_sell: number;
  positions_closed_by_resolution: number;
  total_invested: number;      // Sum of all $1 buys
  total_returned: number;      // Sum of all sell/resolution proceeds
  total_pnl: number;
  max_concurrent_capital: number;
  avg_concurrent_capital: number;
  return_on_max_capital_pct: number;  // PnL / max_capital * 100
  return_on_avg_capital_pct: number;  // PnL / avg_capital * 100
  win_rate_pct: number;
  avg_position_duration_hours: number;
  last_trade: Date;
  // Capital-constrained metrics
  starting_capital: number;
  trades_skipped_no_capital: number;
  final_balance: number;
  return_on_starting_capital_pct: number;
}

async function getWalletsToSimulate(): Promise<string[]> {
  if (SPECIFIC_WALLETS && SPECIFIC_WALLETS.length > 0) {
    return SPECIFIC_WALLETS;
  }

  // Get wallets that pass the filter criteria
  const result = await clickhouse.query({
    query: `
      SELECT wallet
      FROM pm_trade_fifo_roi_v2
      WHERE entry_time >= now() - INTERVAL ${DAYS_BACK} DAY
      GROUP BY wallet
      HAVING
        max(entry_time) >= now() - INTERVAL 5 DAY
        AND countIf(is_maker = 0) * 100.0 / count() >= 5  -- 5% taker
        AND avg(cost_usd) >= 5                             -- avg size >= $5
        AND count() >= 20                                  -- min trades
        AND countIf(roi > 0) * 100.0 / count() > 50       -- win rate > 50%
        AND countIf(roi > 0) * 1.0 / nullIf(countIf(roi <= 0), 0) >= 1.3  -- W/L >= 1.3
        AND quantileIf(0.25)(roi, roi > 0) >= 0.30        -- P25 win >= 30%
      ORDER BY avg(roi) DESC
      LIMIT ${TOP_N * 2}  -- Get extra in case some fail
    `,
    format: 'JSONEachRow'
  });

  const wallets = (await result.json() as { wallet: string }[]).map(r => r.wallet);
  console.log(`Found ${wallets.length} candidate wallets to simulate\n`);
  return wallets;
}

async function getWalletTrades(wallet: string): Promise<Trade[]> {
  // Get all trades (buys and sells) grouped by tx_hash
  const result = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        condition_id,
        outcome_index,
        min(event_time) as trade_time,
        if(sum(tokens_delta) > 0, 'buy', 'sell') as side,
        abs(sum(tokens_delta)) as tokens,
        abs(sum(usdc_delta)) as usdc
      FROM pm_canonical_fills_v4
      WHERE wallet = '${wallet}'
        AND event_time >= now() - INTERVAL ${DAYS_BACK} DAY
        AND source = 'clob'
      GROUP BY tx_hash, condition_id, outcome_index
      HAVING tokens > 0.000001 AND usdc > 0.01
      ORDER BY trade_time ASC
    `,
    format: 'JSONEachRow'
  });

  const trades = (await result.json() as any[]).map(t => ({
    tx_hash: t.tx_hash,
    condition_id: t.condition_id,
    outcome_index: t.outcome_index,
    trade_time: new Date(t.trade_time),
    side: t.side as 'buy' | 'sell',
    tokens: t.tokens,
    usdc: t.usdc,
    price: t.usdc / t.tokens
  }));

  return trades;
}

async function getResolutions(conditionIds: string[]): Promise<Map<string, Resolution>> {
  if (conditionIds.length === 0) return new Map();

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        resolved_at,
        payout_numerators
      FROM pm_condition_resolutions
      WHERE condition_id IN (${conditionList})
        AND is_deleted = 0
        AND payout_numerators != ''
    `,
    format: 'JSONEachRow'
  });

  const resolutions = new Map<string, Resolution>();
  for (const r of await result.json() as any[]) {
    // Parse payout for both outcomes
    const payouts = JSON.parse(r.payout_numerators);
    resolutions.set(r.condition_id + '_0', {
      condition_id: r.condition_id,
      resolved_at: new Date(r.resolved_at),
      payout_rate: payouts[0] === 1 ? 1.0 : (payouts[0] === 0 ? 0 : 0.5)
    });
    resolutions.set(r.condition_id + '_1', {
      condition_id: r.condition_id,
      resolved_at: new Date(r.resolved_at),
      payout_rate: payouts[1] === 1 ? 1.0 : (payouts[1] === 0 ? 0 : 0.5)
    });
  }

  return resolutions;
}

function simulateCopyTrading(
  wallet: string,
  trades: Trade[],
  resolutions: Map<string, Resolution>
): SimulationResult {
  // Open positions: key = condition_id + '_' + outcome_index
  const positions = new Map<string, Position>();

  // Track capital over time for averaging
  const capitalSnapshots: { time: Date; capital: number }[] = [];

  // Capital tracking
  const hasCapitalConstraint = STARTING_CAPITAL > 0;
  let availableCapital = hasCapitalConstraint ? STARTING_CAPITAL : Infinity;
  let tradesSkippedNoCapital = 0;

  let totalInvested = 0;
  let totalReturned = 0;
  let maxConcurrentCapital = 0;
  let positionsOpened = 0;
  let positionsClosedBySell = 0;
  let positionsClosedByResolution = 0;
  let wins = 0;
  let losses = 0;
  let totalDurationMs = 0;
  let closedPositions = 0;

  // Create timeline events: trades + resolutions
  interface Event {
    time: Date;
    type: 'trade' | 'resolution';
    trade?: Trade;
    resolution?: Resolution;
    positionKey?: string;
  }

  const events: Event[] = [];

  // Add trade events
  for (const trade of trades) {
    events.push({ time: trade.trade_time, type: 'trade', trade });
  }

  // Add resolution events for positions we might hold
  const conditionsSeen = new Set<string>();
  for (const trade of trades) {
    if (trade.side === 'buy') {
      conditionsSeen.add(trade.condition_id);
    }
  }

  for (const condId of conditionsSeen) {
    for (const outcomeIdx of [0, 1]) {
      const key = `${condId}_${outcomeIdx}`;
      const resolution = resolutions.get(key);
      if (resolution) {
        events.push({
          time: resolution.resolved_at,
          type: 'resolution',
          resolution,
          positionKey: key
        });
      }
    }
  }

  // Sort by time
  events.sort((a, b) => a.time.getTime() - b.time.getTime());

  // Track position open times for duration calculation
  const positionOpenTimes = new Map<string, Date>();

  // Process events chronologically
  for (const event of events) {
    if (event.type === 'trade' && event.trade) {
      const trade = event.trade;
      const posKey = `${trade.condition_id}_${trade.outcome_index}`;

      if (trade.side === 'buy') {
        // BUY: Deploy $1 (if we have capital)
        if (hasCapitalConstraint && availableCapital < 1) {
          tradesSkippedNoCapital++;
          continue; // Skip this trade - no capital
        }

        const existing = positions.get(posKey);

        if (existing) {
          // Add to existing position
          const tokensForOneDollar = trade.tokens / trade.usdc; // tokens per $1
          existing.tokens_owned += tokensForOneDollar;
          existing.cost_basis += 1;
          existing.their_tokens += trade.tokens;
        } else {
          // New position
          const tokensForOneDollar = trade.tokens / trade.usdc;
          positions.set(posKey, {
            condition_id: trade.condition_id,
            outcome_index: trade.outcome_index,
            tokens_owned: tokensForOneDollar,
            cost_basis: 1,
            their_tokens: trade.tokens
          });
          positionOpenTimes.set(posKey, trade.trade_time);
          positionsOpened++;
        }

        totalInvested += 1;
        if (hasCapitalConstraint) {
          availableCapital -= 1;
        }

      } else if (trade.side === 'sell') {
        // SELL: Close entire position
        const position = positions.get(posKey);

        if (position && position.tokens_owned > 0) {
          // Calculate my proceeds: I sell at their price
          const sellPrice = trade.usdc / trade.tokens; // price per token
          const myProceeds = position.tokens_owned * sellPrice;

          totalReturned += myProceeds;
          if (hasCapitalConstraint) {
            availableCapital += myProceeds; // Capital returned
          }

          // Track win/loss
          const pnl = myProceeds - position.cost_basis;
          if (pnl > 0) wins++;
          else losses++;

          // Track duration
          const openTime = positionOpenTimes.get(posKey);
          if (openTime) {
            totalDurationMs += trade.trade_time.getTime() - openTime.getTime();
            closedPositions++;
          }

          positionsClosedBySell++;
          positions.delete(posKey);
          positionOpenTimes.delete(posKey);
        }
      }

    } else if (event.type === 'resolution' && event.resolution && event.positionKey) {
      // RESOLUTION: Close position if still open
      const position = positions.get(event.positionKey);

      if (position && position.tokens_owned > 0) {
        const payoutPerToken = event.resolution.payout_rate; // 0, 0.5, or 1
        const myProceeds = position.tokens_owned * payoutPerToken;

        totalReturned += myProceeds;
        if (hasCapitalConstraint) {
          availableCapital += myProceeds; // Capital returned
        }

        // Track win/loss
        const pnl = myProceeds - position.cost_basis;
        if (pnl > 0) wins++;
        else losses++;

        // Track duration
        const openTime = positionOpenTimes.get(event.positionKey);
        if (openTime) {
          totalDurationMs += event.resolution.resolved_at.getTime() - openTime.getTime();
          closedPositions++;
        }

        positionsClosedByResolution++;
        positions.delete(event.positionKey);
        positionOpenTimes.delete(event.positionKey);
      }
    }

    // Track current capital deployed
    let currentCapital = 0;
    for (const pos of positions.values()) {
      currentCapital += pos.cost_basis;
    }
    capitalSnapshots.push({ time: event.time, capital: currentCapital });
    maxConcurrentCapital = Math.max(maxConcurrentCapital, currentCapital);
  }

  // Calculate average capital (time-weighted would be better, but simple avg for now)
  const avgCapital = capitalSnapshots.length > 0
    ? capitalSnapshots.reduce((sum, s) => sum + s.capital, 0) / capitalSnapshots.length
    : 0;

  const totalPnl = totalReturned - totalInvested;
  const avgDurationHours = closedPositions > 0 ? (totalDurationMs / closedPositions) / (1000 * 60 * 60) : 0;

  // Calculate final balance (for capital-constrained mode)
  let openPositionValue = 0;
  for (const pos of positions.values()) {
    openPositionValue += pos.cost_basis; // Use cost basis as conservative estimate
  }
  const finalBalance = hasCapitalConstraint ? availableCapital + openPositionValue : 0;
  const returnOnStartingCapital = hasCapitalConstraint && STARTING_CAPITAL > 0
    ? ((finalBalance - STARTING_CAPITAL) / STARTING_CAPITAL) * 100
    : 0;

  return {
    wallet,
    total_trades: trades.length,
    buy_count: trades.filter(t => t.side === 'buy').length,
    sell_count: trades.filter(t => t.side === 'sell').length,
    positions_opened: positionsOpened,
    positions_closed_by_sell: positionsClosedBySell,
    positions_closed_by_resolution: positionsClosedByResolution,
    total_invested: totalInvested,
    total_returned: totalReturned,
    total_pnl: totalPnl,
    max_concurrent_capital: maxConcurrentCapital,
    avg_concurrent_capital: avgCapital,
    return_on_max_capital_pct: maxConcurrentCapital > 0 ? (totalPnl / maxConcurrentCapital) * 100 : 0,
    return_on_avg_capital_pct: avgCapital > 0 ? (totalPnl / avgCapital) * 100 : 0,
    win_rate_pct: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
    avg_position_duration_hours: avgDurationHours,
    last_trade: trades.length > 0 ? trades[trades.length - 1].trade_time : new Date(0),
    // Capital-constrained metrics
    starting_capital: STARTING_CAPITAL,
    trades_skipped_no_capital: tradesSkippedNoCapital,
    final_balance: finalBalance,
    return_on_starting_capital_pct: returnOnStartingCapital
  };
}

async function main() {
  console.log('=== COPY TRADING SIMULATOR ===');
  console.log(`Settings: $1 per buy, sell entire position on their sell`);
  console.log(`Lookback: ${DAYS_BACK} days`);
  console.log(`Starting capital: ${STARTING_CAPITAL > 0 ? '$' + STARTING_CAPITAL : 'UNLIMITED'}`);
  console.log(`Top wallets: ${TOP_N}\n`);

  const wallets = await getWalletsToSimulate();
  const results: SimulationResult[] = [];

  let processed = 0;
  const startTime = Date.now();

  for (const wallet of wallets) {
    try {
      // Get trades
      const trades = await getWalletTrades(wallet);

      if (trades.length < 10) {
        continue; // Skip wallets with too few trades
      }

      // Get resolutions for conditions they traded
      const conditionIds = [...new Set(trades.map(t => t.condition_id))];
      const resolutions = await getResolutions(conditionIds);

      // Simulate
      const result = simulateCopyTrading(wallet, trades, resolutions);

      // Only include if meaningful
      if (result.positions_opened >= 5 && result.max_concurrent_capital > 0) {
        results.push(result);
      }

      processed++;
      if (processed % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = wallets.length - processed;
        const eta = Math.round(remaining / rate);
        process.stdout.write(`\rProcessed ${processed}/${wallets.length} wallets (${results.length} valid) | ETA: ${eta}s   `);
      }

    } catch (err: any) {
      // Skip errors silently
    }

    if (results.length >= TOP_N) break;
  }

  console.log(`\n\nSimulation complete: ${results.length} wallets analyzed\n`);

  // Sort by appropriate metric based on mode
  if (STARTING_CAPITAL > 0) {
    results.sort((a, b) => b.return_on_starting_capital_pct - a.return_on_starting_capital_pct);
  } else {
    results.sort((a, b) => b.return_on_max_capital_pct - a.return_on_max_capital_pct);
  }

  // Print results
  if (STARTING_CAPITAL > 0) {
    console.log(`=== TOP WALLETS (Starting with $${STARTING_CAPITAL}) ===\n`);
    console.log('Wallet                                     | Buys | Copied | Skipped | Final $ |   PnL   |  ROI%  | Win% | AvgDur');
    console.log('-------------------------------------------|------|--------|---------|---------|---------|--------|------|-------');

    for (let i = 0; i < Math.min(results.length, TOP_N); i++) {
      const r = results[i];
      console.log(
        `${r.wallet} | ` +
        `${String(r.buy_count).padStart(4)} | ` +
        `${String(r.positions_opened).padStart(6)} | ` +
        `${String(r.trades_skipped_no_capital).padStart(7)} | ` +
        `$${r.final_balance.toFixed(0).padStart(6)} | ` +
        `$${(r.final_balance - STARTING_CAPITAL).toFixed(0).padStart(6)} | ` +
        `${r.return_on_starting_capital_pct.toFixed(1).padStart(5)}% | ` +
        `${r.win_rate_pct.toFixed(0).padStart(3)}% | ` +
        `${r.avg_position_duration_hours.toFixed(1).padStart(5)}h`
      );
    }
  } else {
    console.log('=== TOP WALLETS BY RETURN ON CAPITAL ===\n');
    console.log('Wallet                                     | Trades | Buys | Sells | MaxCap | AvgCap | Invested | Returned |   PnL   | ROI/Max | ROI/Avg | Win% | AvgDur');
    console.log('-------------------------------------------|--------|------|-------|--------|--------|----------|----------|---------|---------|---------|------|-------');

    for (let i = 0; i < Math.min(results.length, TOP_N); i++) {
      const r = results[i];
      console.log(
        `${r.wallet} | ` +
        `${String(r.total_trades).padStart(6)} | ` +
        `${String(r.buy_count).padStart(4)} | ` +
        `${String(r.sell_count).padStart(5)} | ` +
        `$${r.max_concurrent_capital.toFixed(0).padStart(5)} | ` +
        `$${r.avg_concurrent_capital.toFixed(0).padStart(5)} | ` +
        `$${r.total_invested.toFixed(0).padStart(7)} | ` +
        `$${r.total_returned.toFixed(0).padStart(7)} | ` +
        `$${r.total_pnl.toFixed(0).padStart(6)} | ` +
        `${r.return_on_max_capital_pct.toFixed(0).padStart(6)}% | ` +
        `${r.return_on_avg_capital_pct.toFixed(0).padStart(6)}% | ` +
        `${r.win_rate_pct.toFixed(0).padStart(3)}% | ` +
        `${r.avg_position_duration_hours.toFixed(1).padStart(5)}h`
      );
    }
  }

  // Summary stats
  console.log('\n=== SUMMARY ===');
  if (STARTING_CAPITAL > 0) {
    const profitable = results.filter(r => r.final_balance > STARTING_CAPITAL);
    console.log(`Starting capital: $${STARTING_CAPITAL}`);
    console.log(`Profitable wallets: ${profitable.length}/${results.length} (${(profitable.length/results.length*100).toFixed(0)}%)`);
    console.log(`Avg ROI: ${(results.reduce((s, r) => s + r.return_on_starting_capital_pct, 0) / results.length).toFixed(1)}%`);
    console.log(`Best final balance: $${results[0]?.final_balance.toFixed(2)} (${results[0]?.return_on_starting_capital_pct.toFixed(1)}% ROI)`);
    console.log(`Best wallet: ${results[0]?.wallet}`);
  } else {
    const profitable = results.filter(r => r.total_pnl > 0);
    console.log(`Profitable wallets: ${profitable.length}/${results.length} (${(profitable.length/results.length*100).toFixed(0)}%)`);
    console.log(`Avg ROI on max capital: ${(results.reduce((s, r) => s + r.return_on_max_capital_pct, 0) / results.length).toFixed(1)}%`);
    console.log(`Best ROI on max capital: ${results[0]?.return_on_max_capital_pct.toFixed(1)}%`);
  }

  // Output JSON for further analysis
  const outputPath = `./copy-trading-sim-${DAYS_BACK}d.json`;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to: ${outputPath}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
