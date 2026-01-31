#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard v19
 *
 * Creates a top 50 leaderboard by Log Return % Per Day with the following filters:
 * 1. PnL > $0
 * 2. At least one trade in last 4 days
 * 3. > 35 trades
 * 4. > 8 markets
 * 5. First trade > 14 days ago
 * 6. Median ROI % > 10%
 * 7. Median win ROI % != 100% (exclude split arbitrageurs)
 * 8. Winsorize: hide top/bottom 2.5% ROI trades per wallet
 * 9. Calculate Log Return % per day
 * 10. Rank top 50
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

async function query<T>(sql: string): Promise<T[]> {
  const result = await client.query({ query: sql, format: 'JSONEachRow' });
  return result.json();
}

interface WalletPrefilter {
  wallet: string;
  total_pnl: number;
  total_trades: number;
  markets_traded: number;
  first_trade: string;
  last_trade: string;
  median_roi_pct: number;
  median_win_roi_pct: number | null;
}

interface TradeData {
  wallet: string;
  entry_time: string;
  pnl_usd: number;
  roi: number;
  condition_id: string;
}

interface LeaderboardEntry {
  wallet: string;
  log_return_pct_per_day: number;
  avg_roi_pct: number;
  win_rate_pct: number;
  median_win_roi_pct: number;
  median_loss_roi_pct: number;
  winning_trades: number;
  losing_trades: number;
  trades_per_day: number;
  total_trades: number;
  days_active: number;
  edge_per_trade: number;
  volatility: number;
  markets_traded: number;
  first_trade: string;
  last_trade: string;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

async function main() {
  console.log('=== Copytrading Leaderboard v19 ===\n');
  console.log('Step 1-7: Filtering wallets with all criteria...');

  // Step 1-7: Get wallets that pass all initial filters
  const prefilterQuery = `
    WITH deduplicated AS (
        SELECT
            tx_hash, wallet, condition_id, outcome_index,
            any(entry_time) as entry_time,
            any(pnl_usd) as pnl_usd,
            any(roi) as roi
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE is_closed = 1
        GROUP BY tx_hash, wallet, condition_id, outcome_index
    )
    SELECT
        wallet,
        sum(pnl_usd) as total_pnl,
        count() as total_trades,
        countDistinct(condition_id) as markets_traded,
        min(entry_time) as first_trade,
        max(entry_time) as last_trade,
        median(roi * 100) as median_roi_pct,
        medianIf(roi * 100, pnl_usd > 0) as median_win_roi_pct
    FROM deduplicated
    GROUP BY wallet
    HAVING total_pnl > 0
      AND last_trade >= now() - INTERVAL 4 DAY
      AND total_trades > 35
      AND markets_traded > 8
      AND first_trade < now() - INTERVAL 14 DAY
      AND median_roi_pct > 10
      AND (median_win_roi_pct != 100 OR median_win_roi_pct IS NULL)
  `;

  const filteredWallets = await query<WalletPrefilter>(prefilterQuery);
  console.log(`  Found ${filteredWallets.length} wallets passing filters 1-7\n`);

  if (filteredWallets.length === 0) {
    console.log('No wallets found matching criteria.');
    await client.close();
    return;
  }

  console.log('Step 8-9: Processing each wallet with winsorization and log return calculation...\n');

  const leaderboard: LeaderboardEntry[] = [];

  // Process each wallet
  for (let i = 0; i < filteredWallets.length; i++) {
    const w = filteredWallets[i];
    process.stdout.write(`  Processing wallet ${i + 1}/${filteredWallets.length}: ${w.wallet.substring(0, 10)}...`);

    // Get all trades for this wallet
    const tradesQuery = `
      SELECT
          wallet,
          condition_id,
          any(entry_time) as entry_time,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet = '${w.wallet}' AND is_closed = 1
      GROUP BY tx_hash, wallet, condition_id, outcome_index
      ORDER BY entry_time
    `;

    const trades = await query<TradeData>(tradesQuery);

    if (trades.length === 0) {
      console.log(' - No trades found, skipping');
      continue;
    }

    // Step 8: Winsorize - calculate percentiles and filter
    const rois = trades.map(t => t.roi);
    const sortedRois = [...rois].sort((a, b) => a - b);
    const p2_5_idx = Math.floor(sortedRois.length * 0.025);
    const p97_5_idx = Math.ceil(sortedRois.length * 0.975) - 1;
    const p2_5 = sortedRois[p2_5_idx];
    const p97_5 = sortedRois[p97_5_idx];

    // Filter trades within the 2.5%-97.5% range (exclusive)
    const winsorizedTrades = trades.filter(t => t.roi > p2_5 && t.roi < p97_5);

    if (winsorizedTrades.length === 0) {
      console.log(' - No trades after winsorization, skipping');
      continue;
    }

    // Calculate metrics on winsorized trades
    const winningTrades = winsorizedTrades.filter(t => t.pnl_usd > 0);
    const losingTrades = winsorizedTrades.filter(t => t.pnl_usd <= 0);

    const winRois = winningTrades.map(t => t.roi * 100);
    const lossRois = losingTrades.map(t => t.roi * 100);
    const allRois = winsorizedTrades.map(t => t.roi * 100);

    const firstTradeDate = new Date(winsorizedTrades[0].entry_time);
    const lastTradeDate = new Date(winsorizedTrades[winsorizedTrades.length - 1].entry_time);
    const daysActive = Math.max(1, Math.ceil((lastTradeDate.getTime() - firstTradeDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Step 9: Calculate Log Return
    // Log Return = sum(ln(1 + roi)) for each trade
    // Cap ROI at -0.99 to handle shorts/leverage (max 99% loss in log space)
    const totalLogReturn = winsorizedTrades.reduce((sum, t) => {
      // Cap at -0.99 (99% loss) to maintain mathematical validity for log returns
      const cappedRoi = Math.max(t.roi, -0.99);
      return sum + Math.log(1 + cappedRoi);
    }, 0);

    const logReturnPctPerDay = (totalLogReturn / daysActive) * 100;

    const winRate = (winningTrades.length / winsorizedTrades.length) * 100;
    const medianWinRoi = median(winRois);
    const medianLossRoi = median(lossRois);
    const avgRoi = allRois.reduce((a, b) => a + b, 0) / allRois.length;

    // Edge per trade: EV = win_rate × median_win_roi - loss_rate × |median_loss_roi|
    const lossRate = 100 - winRate;
    const edgePerTrade = (winRate / 100) * medianWinRoi - (lossRate / 100) * Math.abs(medianLossRoi);

    const uniqueMarkets = new Set(winsorizedTrades.map(t => t.condition_id)).size;

    leaderboard.push({
      wallet: w.wallet,
      log_return_pct_per_day: logReturnPctPerDay,
      avg_roi_pct: avgRoi,
      win_rate_pct: winRate,
      median_win_roi_pct: medianWinRoi,
      median_loss_roi_pct: medianLossRoi,
      winning_trades: winningTrades.length,
      losing_trades: losingTrades.length,
      trades_per_day: winsorizedTrades.length / daysActive,
      total_trades: winsorizedTrades.length,
      days_active: daysActive,
      edge_per_trade: edgePerTrade,
      volatility: stddev(allRois),
      markets_traded: uniqueMarkets,
      first_trade: winsorizedTrades[0].entry_time,
      last_trade: winsorizedTrades[winsorizedTrades.length - 1].entry_time,
    });

    console.log(` Log Return: ${logReturnPctPerDay.toFixed(4)}%/day`);
  }

  // Step 10: Sort and get top 50
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                              TOP 50 LEADERBOARD BY LOG RETURN % PER DAY                                                                                                                   ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣');

  leaderboard.sort((a, b) => b.log_return_pct_per_day - a.log_return_pct_per_day);
  const top50 = leaderboard.slice(0, 50);

  // Print formatted table
  console.log('');
  console.log('Rank | Wallet Address                             | Log Ret%/Day | Avg ROI% | Win Rate% | Med Win% | Med Loss% | Wins | Losses | Trades/Day | Total | Days | Edge | Vol  | Markets | First Trade | Last Trade');
  console.log('-----|--------------------------------------------|--------------:|----------:|----------:|---------:|----------:|-----:|-------:|-----------:|------:|-----:|-----:|-----:|--------:|-------------|------------');

  top50.forEach((entry, idx) => {
    const rank = String(idx + 1).padStart(4);
    const logRet = entry.log_return_pct_per_day.toFixed(2).padStart(12);
    const avgRoi = entry.avg_roi_pct.toFixed(1).padStart(9);
    const winRate = entry.win_rate_pct.toFixed(1).padStart(9);
    const medWin = entry.median_win_roi_pct.toFixed(1).padStart(8);
    const medLoss = entry.median_loss_roi_pct.toFixed(1).padStart(9);
    const wins = String(entry.winning_trades).padStart(4);
    const losses = String(entry.losing_trades).padStart(6);
    const tpd = entry.trades_per_day.toFixed(1).padStart(10);
    const total = String(entry.total_trades).padStart(5);
    const days = String(entry.days_active).padStart(4);
    const edge = entry.edge_per_trade.toFixed(1).padStart(4);
    const vol = entry.volatility.toFixed(0).padStart(4);
    const markets = String(entry.markets_traded).padStart(7);
    const firstDate = entry.first_trade.split(' ')[0];
    const lastDate = entry.last_trade.split(' ')[0];

    console.log(`${rank} | ${entry.wallet} |${logRet} |${avgRoi} |${winRate} |${medWin} |${medLoss} |${wins} |${losses} |${tpd} |${total} |${days} |${edge} |${vol} |${markets} | ${firstDate} | ${lastDate}`);
  });

  console.log('');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Legend:');
  console.log('  Log Ret%/Day = Log Return % per Day (sum of ln(1+roi) / days active * 100)');
  console.log('  Edge = Win_rate × Median_win - Loss_rate × |Median_loss|');
  console.log('  Vol = Standard deviation of ROI % (volatility)');

  // Also output as JSON for further processing
  console.log('\n\n=== JSON OUTPUT ===\n');
  console.log(JSON.stringify(top50, null, 2));

  await client.close();
  console.log('\n\nDone!');
}

main().catch(console.error);
