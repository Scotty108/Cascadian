#!/usr/bin/env npx tsx
/**
 * Copy Trade Simulation
 *
 * Goes through every trade step by step and simulates $1 per trade
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const WALLET = '0x96489abcb9f583d6835c8ef95ffc923d05a86825';
const BET_SIZE = 1.0; // $1 per trade

interface Trade {
  tx_hash: string;
  entry_time: string;
  resolved_at: string;
  cost_usd: number;
  pnl_usd: number;
  roi: number;
}

async function main() {
  console.log('=== Copy Trade Simulation ===');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Bet Size: $${BET_SIZE} per trade`);
  console.log(`Period: Last 14 days (resolved trades only)\n`);

  // Fetch all trades
  const result = await client.query({
    query: `
      SELECT
        tx_hash,
        entry_time,
        resolved_at,
        cost_usd,
        pnl_usd,
        pnl_usd / cost_usd as roi
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet = '${WALLET}'
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
        AND entry_time >= now() - INTERVAL 14 DAY
      ORDER BY entry_time ASC
    `,
    format: 'JSONEachRow',
  });

  const trades = await result.json() as Trade[];
  console.log(`Total resolved trades found: ${trades.length}\n`);

  if (trades.length === 0) {
    console.log('No trades found!');
    await client.close();
    return;
  }

  // Go through each trade step by step
  let totalBet = 0;
  let totalPnL = 0;
  let wins = 0;
  let losses = 0;
  let holdTimesMinutes: number[] = [];

  // Daily tracking
  const dailyStats: Map<string, { trades: number; pnl: number; wins: number; losses: number }> = new Map();

  // Hourly tracking
  let firstTradeTime: Date | null = null;
  let lastTradeTime: Date | null = null;

  console.log('Processing trades step by step...\n');

  // Process each trade
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    const entryTime = new Date(trade.entry_time);
    const resolvedTime = new Date(trade.resolved_at);

    // Calculate hold time in minutes
    const holdTimeMs = resolvedTime.getTime() - entryTime.getTime();
    const holdTimeMinutes = holdTimeMs / (1000 * 60);
    holdTimesMinutes.push(holdTimeMinutes);

    // Simulate $1 bet
    const betAmount = BET_SIZE;
    const simulatedPnL = trade.roi * betAmount; // ROI * bet = PnL

    totalBet += betAmount;
    totalPnL += simulatedPnL;

    if (trade.pnl_usd > 0) {
      wins++;
    } else {
      losses++;
    }

    // Track first/last trade
    if (!firstTradeTime) firstTradeTime = entryTime;
    lastTradeTime = entryTime;

    // Daily tracking
    const dayKey = entryTime.toISOString().split('T')[0];
    const dayStats = dailyStats.get(dayKey) || { trades: 0, pnl: 0, wins: 0, losses: 0 };
    dayStats.trades++;
    dayStats.pnl += simulatedPnL;
    if (trade.pnl_usd > 0) dayStats.wins++;
    else dayStats.losses++;
    dailyStats.set(dayKey, dayStats);

    // Print progress every 100 trades
    if ((i + 1) % 100 === 0 || i === trades.length - 1) {
      console.log(`  Processed ${i + 1}/${trades.length} trades | Cumulative PnL: $${totalPnL.toFixed(4)}`);
    }
  }

  // Calculate time-based metrics
  const totalHours = firstTradeTime && lastTradeTime
    ? (lastTradeTime.getTime() - firstTradeTime.getTime()) / (1000 * 60 * 60)
    : 0;
  const totalDays = totalHours / 24;

  // Calculate average hold time
  const avgHoldTimeMinutes = holdTimesMinutes.reduce((a, b) => a + b, 0) / holdTimesMinutes.length;
  const minHoldTime = Math.min(...holdTimesMinutes);
  const maxHoldTime = Math.max(...holdTimesMinutes);
  const medianHoldTime = holdTimesMinutes.sort((a, b) => a - b)[Math.floor(holdTimesMinutes.length / 2)];

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('SIMULATION RESULTS - $1 PER TRADE');
  console.log('='.repeat(70));

  console.log('\n--- TOTALS (Last 14 Days) ---');
  console.log(`Total Trades:          ${trades.length}`);
  console.log(`Total Amount Bet:      $${totalBet.toFixed(2)}`);
  console.log(`Total PnL:             $${totalPnL.toFixed(4)}`);
  console.log(`ROI:                   ${(totalPnL / totalBet * 100).toFixed(4)}%`);
  console.log(`Wins:                  ${wins}`);
  console.log(`Losses:                ${losses}`);
  console.log(`Win Rate:              ${(wins / trades.length * 100).toFixed(2)}%`);

  console.log('\n--- TIME METRICS ---');
  console.log(`First Trade:           ${firstTradeTime?.toISOString()}`);
  console.log(`Last Trade:            ${lastTradeTime?.toISOString()}`);
  console.log(`Total Period:          ${totalHours.toFixed(1)} hours (${totalDays.toFixed(2)} days)`);

  console.log('\n--- HOLD TIME ---');
  console.log(`Average Hold Time:     ${avgHoldTimeMinutes.toFixed(2)} minutes (${(avgHoldTimeMinutes / 60).toFixed(2)} hours)`);
  console.log(`Median Hold Time:      ${medianHoldTime.toFixed(2)} minutes`);
  console.log(`Min Hold Time:         ${minHoldTime.toFixed(2)} minutes`);
  console.log(`Max Hold Time:         ${maxHoldTime.toFixed(2)} minutes (${(maxHoldTime / 60 / 24).toFixed(2)} days)`);

  console.log('\n--- RATE METRICS ---');
  console.log(`Trades per Hour:       ${(trades.length / totalHours).toFixed(4)}`);
  console.log(`$ Bet per Hour:        $${(totalBet / totalHours).toFixed(4)}`);
  console.log(`PnL per Hour:          $${(totalPnL / totalHours).toFixed(6)}`);
  console.log(`PnL per Hour (%):      ${(totalPnL / totalHours / totalBet * trades.length * 100).toFixed(6)}%`);
  console.log(`Trades per Day:        ${(trades.length / totalDays).toFixed(2)}`);
  console.log(`$ Bet per Day:         $${(totalBet / totalDays).toFixed(2)}`);
  console.log(`PnL per Day:           $${(totalPnL / totalDays).toFixed(4)}`);
  console.log(`PnL per Day (%):       ${(totalPnL / totalDays / (totalBet / totalDays) * 100).toFixed(4)}%`);

  console.log('\n--- DAILY BREAKDOWN ---');
  console.log('Date       | Trades | Bet ($) | PnL ($)   | ROI (%)   | Win Rate');
  console.log('-'.repeat(70));

  const sortedDays = Array.from(dailyStats.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  for (const [day, stats] of sortedDays) {
    const roi = (stats.pnl / stats.trades * 100).toFixed(2);
    const winRate = (stats.wins / stats.trades * 100).toFixed(1);
    console.log(`${day} | ${stats.trades.toString().padStart(6)} | $${stats.trades.toFixed(2).padStart(6)} | $${stats.pnl.toFixed(4).padStart(8)} | ${roi.padStart(8)}% | ${winRate}%`);
  }

  // Last 24 hours (from resolved data)
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last24hTrades = trades.filter(t => new Date(t.entry_time) >= oneDayAgo);
  const last24hPnL = last24hTrades.reduce((sum, t) => sum + t.roi * BET_SIZE, 0);

  console.log('\n--- LAST 24 HOURS (Resolved Only) ---');
  console.log(`Trades:                ${last24hTrades.length}`);
  console.log(`Amount Bet:            $${last24hTrades.length.toFixed(2)}`);
  console.log(`PnL:                   $${last24hPnL.toFixed(4)}`);
  if (last24hTrades.length > 0) {
    console.log(`ROI:                   ${(last24hPnL / last24hTrades.length * 100).toFixed(4)}%`);
    console.log(`PnL per Hour:          $${(last24hPnL / 24).toFixed(6)}`);
  }

  // Scaling examples
  console.log('\n--- IF SCALED TO $10 PER TRADE ---');
  console.log(`Total Bet:             $${(totalBet * 10).toFixed(2)}`);
  console.log(`Total PnL:             $${(totalPnL * 10).toFixed(2)}`);
  console.log(`PnL per Day:           $${(totalPnL * 10 / totalDays).toFixed(2)}`);
  console.log(`PnL per Hour:          $${(totalPnL * 10 / totalHours).toFixed(4)}`);

  console.log('\n--- IF SCALED TO $100 PER TRADE ---');
  console.log(`Total Bet:             $${(totalBet * 100).toFixed(2)}`);
  console.log(`Total PnL:             $${(totalPnL * 100).toFixed(2)}`);
  console.log(`PnL per Day:           $${(totalPnL * 100 / totalDays).toFixed(2)}`);
  console.log(`PnL per Hour:          $${(totalPnL * 100 / totalHours).toFixed(2)}`);

  console.log('\n' + '='.repeat(70));

  await client.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
