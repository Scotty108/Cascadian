#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard v11
 *
 * Creates a Top 50 copytrading leaderboard ranked by Log Growth Per Day
 * using a wallet-by-wallet copier simulation with:
 * - Last 90 days of data only
 * - Minimum bet size > $1 (using $2)
 * - Auto-redeem enabled (full compounding)
 * - Independent bankroll per wallet simulation
 */

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

// Clean up CLICKHOUSE_HOST - remove trailing slash if present
const clickhouseHost = process.env.CLICKHOUSE_HOST?.replace(/\/$/, '') || '';

const client = createClient({
  url: clickhouseHost.startsWith('http')
    ? clickhouseHost
    : `https://${clickhouseHost}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || process.env.CLICKHOUSE_KEY_SECRET,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const BET_SIZE = 2.0; // Minimum bet size > $1

interface Trade {
  wallet: string;
  entry_time: number;
  exit_time: number;
  roi_capped: number;
  condition_id: string;
}

interface WalletStats {
  wallet: string;
  total_trades: number;
  markets_traded: number;
  win_rate_pct: number;
  median_roi_pct: number;
  median_bet_size: number;
  median_win_roi_pct: number;
  median_loss_roi_pct: number;
  wins: number;
  losses: number;
  first_trade: Date;
  last_trade: Date;
}

interface SimulationResult {
  wallet: string;
  log_growth_per_day: number;
  simulated_return_pct_per_day: number;
  roi_pct_per_day: number;
  trades_per_day: number;
  final_bankroll: number;
  initial_bankroll: number;
  trades_copied: number;
  trades_skipped: number;
  edge_per_trade: number;
  compounding_score: number;
  win_rate_pct: number;
  median_roi_pct: number;
  last_trade: Date;
  total_trades: number;
  markets_traded: number;
  active_days: number;
}

async function getQualifiedWallets(): Promise<WalletStats[]> {
  console.log('Step 1-6: Filtering wallets meeting all criteria in last 90 days...');

  const query = `
    WITH
      now() AS current_time,
      toDateTime(current_time - interval 90 day) AS cutoff_90d
    SELECT
      wallet,
      count() as total_trades,
      countDistinct(condition_id) as markets_traded,
      countIf(roi > 0) as wins,
      countIf(roi <= 0) as losses,
      countIf(roi > 0) * 100.0 / count() as win_rate_pct,
      median(roi * 100) as median_roi_pct,
      median(abs(cost_usd)) as median_bet_size,
      medianIf(roi * 100, roi > 0) as median_win_roi_pct,
      medianIf(abs(roi * 100), roi <= 0) as median_loss_roi_pct,
      min(entry_time) as first_trade,
      max(entry_time) as last_trade
    FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
    WHERE
      is_closed = 1
      AND is_short = 0
      AND cost_usd > 0
      AND entry_time >= cutoff_90d
    GROUP BY wallet
    HAVING
      total_trades > 30
      AND markets_traded > 7
      AND win_rate_pct > 40
      AND median_roi_pct > 10
      AND median_bet_size > 5
    ORDER BY total_trades DESC
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as WalletStats[];

  console.log(`  Found ${wallets.length} qualifying wallets`);
  return wallets;
}

async function getWalletTrades(wallet: string): Promise<Trade[]> {
  const query = `
    WITH
      now() AS current_time,
      toDateTime(current_time - interval 90 day) AS cutoff_90d,
      (
        SELECT quantile(0.95)(roi)
        FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
        WHERE wallet = {wallet:String}
          AND is_closed = 1
          AND is_short = 0
          AND cost_usd > 0
          AND entry_time >= cutoff_90d
      ) AS roi_p95
    SELECT
      wallet,
      toUInt64(entry_time) as entry_time,
      toUInt64(assumeNotNull(resolved_at)) as exit_time,
      least(roi, roi_p95) as roi_capped,
      condition_id
    FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
    WHERE
      wallet = {wallet:String}
      AND is_closed = 1
      AND is_short = 0
      AND cost_usd > 0
      AND entry_time >= cutoff_90d
      AND resolved_at IS NOT NULL
    ORDER BY entry_time
  `;

  const result = await client.query({
    query,
    format: 'JSONEachRow',
    query_params: { wallet }
  });
  return await result.json() as Trade[];
}

interface Event {
  time: number;
  type: 'BUY' | 'SELL';
  trade_idx: number;
  roi: number;
  market_id: string;
}

function simulateCopier(trades: Trade[]): {
  final_bankroll: number;
  trades_copied: number;
  trades_skipped: number;
  first_event_time: number;
  last_event_time: number;
} {
  if (trades.length === 0) {
    return {
      final_bankroll: BET_SIZE,
      trades_copied: 0,
      trades_skipped: 0,
      first_event_time: 0,
      last_event_time: 0,
    };
  }

  // Create events from trades
  const events: Event[] = [];
  trades.forEach((trade, idx) => {
    events.push({
      time: trade.entry_time,
      type: 'BUY',
      trade_idx: idx,
      roi: trade.roi_capped,
      market_id: trade.condition_id,
    });
    events.push({
      time: trade.exit_time,
      type: 'SELL',
      trade_idx: idx,
      roi: trade.roi_capped,
      market_id: trade.condition_id,
    });
  });

  // Sort events by time, with SELLs before BUYs at same timestamp (to free up cash first)
  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    // SELL (2) before BUY (1) at same time
    return a.type === 'SELL' ? -1 : 1;
  });

  // Initialize simulation
  // Start with enough cash for a reasonable simulation - we'll use the number of trades
  // as initial bankroll to ensure we can copy some trades
  const initial_bankroll = BET_SIZE;
  let cash = initial_bankroll;
  const positions: Map<number, number> = new Map(); // trade_idx -> invested amount
  let trades_copied = 0;
  let trades_skipped = 0;

  const first_event_time = events[0].time;
  const last_event_time = events[events.length - 1].time;

  // Process events
  for (const event of events) {
    if (event.type === 'BUY') {
      if (cash >= BET_SIZE) {
        // Copy the trade
        positions.set(event.trade_idx, BET_SIZE);
        cash -= BET_SIZE;
        trades_copied++;
      } else {
        // Skip - insufficient cash
        trades_skipped++;
      }
    } else {
      // SELL
      const invested = positions.get(event.trade_idx);
      if (invested !== undefined) {
        // We have this position, sell it
        const proceeds = invested * (1 + event.roi);
        cash += proceeds;
        positions.delete(event.trade_idx);
      }
      // If we don't have the position, we skipped it, nothing to do
    }
  }

  // Final bankroll includes any remaining open positions at their current value
  // (though in theory all should be closed since we only take closed trades)
  let final_bankroll = cash;
  for (const [trade_idx, invested] of positions) {
    // Find the ROI for this trade
    const trade = trades[trade_idx];
    final_bankroll += invested * (1 + trade.roi_capped);
  }

  return {
    final_bankroll,
    trades_copied,
    trades_skipped,
    first_event_time,
    last_event_time,
  };
}

function calculateLogGrowthPerDay(
  initial_bankroll: number,
  final_bankroll: number,
  first_event_time: number,
  last_event_time: number
): number {
  if (initial_bankroll <= 0 || final_bankroll <= 0) return -Infinity;

  const days = Math.max(1, (last_event_time - first_event_time) / 86400);
  return Math.log(final_bankroll / initial_bankroll) / days;
}

async function main() {
  console.log('='.repeat(80));
  console.log('COPYTRADING LEADERBOARD v11 - Top 50 by Log Growth Per Day');
  console.log('Last 90 days | Bet size: $2 | Auto-redeem + Full compounding');
  console.log('='.repeat(80));
  console.log('');

  try {
    // Step 1-6: Get qualifying wallets
    const qualifiedWallets = await getQualifiedWallets();

    if (qualifiedWallets.length === 0) {
      console.log('No wallets meet the qualification criteria.');
      return;
    }

    console.log('');
    console.log('Step 7-8: Running copier simulation for each wallet...');

    const results: SimulationResult[] = [];
    let processed = 0;

    for (const walletStats of qualifiedWallets) {
      processed++;
      if (processed % 10 === 0 || processed === qualifiedWallets.length) {
        process.stdout.write(`\r  Processing wallet ${processed}/${qualifiedWallets.length}...`);
      }

      // Get trades for this wallet
      const trades = await getWalletTrades(walletStats.wallet);

      if (trades.length === 0) continue;

      // Run simulation
      const sim = simulateCopier(trades);

      if (sim.trades_copied === 0) continue;

      const initial_bankroll = BET_SIZE;
      const log_growth = calculateLogGrowthPerDay(
        initial_bankroll,
        sim.final_bankroll,
        sim.first_event_time,
        sim.last_event_time
      );

      const active_days = Math.max(1, (sim.last_event_time - sim.first_event_time) / 86400);
      const total_return = (sim.final_bankroll - initial_bankroll) / initial_bankroll;
      const return_per_day = total_return / active_days;

      // Calculate edge per trade (average ROI per copied trade)
      const avg_roi_per_trade = trades.length > 0
        ? trades.reduce((sum, t) => sum + t.roi_capped, 0) / trades.length
        : 0;

      // Compounding score: ratio of actual growth to sum of individual returns
      // Higher = better compounding efficiency
      const sum_of_returns = trades.reduce((sum, t) => sum + t.roi_capped, 0);
      const compounding_score = sum_of_returns !== 0
        ? Math.log(sim.final_bankroll / initial_bankroll) / sum_of_returns
        : 0;

      results.push({
        wallet: walletStats.wallet,
        log_growth_per_day: log_growth,
        simulated_return_pct_per_day: return_per_day * 100,
        roi_pct_per_day: (walletStats.median_roi_pct / 100) * (walletStats.total_trades / active_days),
        trades_per_day: walletStats.total_trades / active_days,
        final_bankroll: sim.final_bankroll,
        initial_bankroll: initial_bankroll,
        trades_copied: sim.trades_copied,
        trades_skipped: sim.trades_skipped,
        edge_per_trade: avg_roi_per_trade * 100,
        compounding_score: compounding_score,
        win_rate_pct: walletStats.win_rate_pct,
        median_roi_pct: walletStats.median_roi_pct,
        last_trade: new Date(Number(walletStats.last_trade)),
        total_trades: walletStats.total_trades,
        markets_traded: walletStats.markets_traded,
        active_days: active_days,
      });
    }

    console.log('\n');

    // Step 9: Rank by LogGrowthPerDay and take top 50
    console.log('Step 9: Ranking by Log Growth Per Day...');
    results.sort((a, b) => b.log_growth_per_day - a.log_growth_per_day);
    const top50 = results.slice(0, 50);

    // Step 10: Display leaderboard
    console.log('');
    console.log('='.repeat(180));
    console.log('TOP 50 COPYTRADING LEADERBOARD - Ranked by Log Growth Per Day');
    console.log('='.repeat(180));
    console.log('');

    // Header
    console.log(
      'Rank'.padStart(4) + ' | ' +
      'Wallet'.padEnd(42) + ' | ' +
      'LogGrowth/Day'.padStart(13) + ' | ' +
      'SimRet%/Day'.padStart(11) + ' | ' +
      'ROI%/Day'.padStart(9) + ' | ' +
      'Trades/Day'.padStart(10) + ' | ' +
      'FinalBank'.padStart(12) + ' | ' +
      'Copied'.padStart(7) + ' | ' +
      'Skip'.padStart(5) + ' | ' +
      'Edge/Trade'.padStart(10) + ' | ' +
      'Compound'.padStart(8) + ' | ' +
      'WinRate%'.padStart(8) + ' | ' +
      'MedROI%'.padStart(8) + ' | ' +
      'LastTrade'
    );
    console.log('-'.repeat(180));

    top50.forEach((r, idx) => {
      const lastTradeStr = r.last_trade instanceof Date
        ? r.last_trade.toISOString().split('T')[0]
        : String(r.last_trade).split('T')[0];

      console.log(
        String(idx + 1).padStart(4) + ' | ' +
        r.wallet.padEnd(42) + ' | ' +
        r.log_growth_per_day.toFixed(6).padStart(13) + ' | ' +
        r.simulated_return_pct_per_day.toFixed(2).padStart(11) + ' | ' +
        r.roi_pct_per_day.toFixed(2).padStart(9) + ' | ' +
        r.trades_per_day.toFixed(1).padStart(10) + ' | ' +
        ('$' + r.final_bankroll.toFixed(2)).padStart(12) + ' | ' +
        String(r.trades_copied).padStart(7) + ' | ' +
        String(r.trades_skipped).padStart(5) + ' | ' +
        (r.edge_per_trade.toFixed(2) + '%').padStart(10) + ' | ' +
        r.compounding_score.toFixed(4).padStart(8) + ' | ' +
        r.win_rate_pct.toFixed(1).padStart(8) + ' | ' +
        r.median_roi_pct.toFixed(1).padStart(8) + ' | ' +
        lastTradeStr
      );
    });

    console.log('');
    console.log('='.repeat(180));
    console.log(`Total qualifying wallets: ${results.length}`);
    console.log(`Simulation parameters: Bet size = $${BET_SIZE}, Initial bankroll = $${BET_SIZE}`);
    console.log('');

    // Also output as JSON for programmatic use
    console.log('\n--- JSON Output ---');
    console.log(JSON.stringify(top50.map((r, idx) => ({
      rank: idx + 1,
      wallet: r.wallet,
      log_growth_per_day: r.log_growth_per_day,
      simulated_return_pct_per_day: r.simulated_return_pct_per_day,
      roi_pct_per_day: r.roi_pct_per_day,
      trades_per_day: r.trades_per_day,
      final_bankroll: r.final_bankroll,
      trades_copied: r.trades_copied,
      trades_skipped: r.trades_skipped,
      edge_per_trade: r.edge_per_trade,
      compounding_score: r.compounding_score,
      win_rate_pct: r.win_rate_pct,
      median_roi_pct: r.median_roi_pct,
      last_trade: r.last_trade,
    })), null, 2));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await client.close();
  }
}

main();
