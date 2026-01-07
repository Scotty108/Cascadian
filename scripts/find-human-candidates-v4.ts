/**
 * Find Human Copy-Trading Candidates - V4
 * Simpler approach: check recent activity first, then daily patterns
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== FINDING HUMAN COPY-TRADING CANDIDATES V4 ===\n');
  console.log('Filters: PnL > 0, 10+ trades, active 10 days, max 200 trades/day\n');

  // Step 1: Get profitable wallets
  console.log('Step 1: Finding profitable wallets with 10+ positions...');

  const profitableQuery = await clickhouse.query({
    query: `
      SELECT
        wallet,
        sum(realized_pnl) as total_pnl,
        count() as positions,
        sum(is_win) as wins,
        sum(is_win) / count() as win_rate
      FROM pm_wallet_condition_realized_v1
      GROUP BY wallet
      HAVING
        sum(realized_pnl) > 0
        AND count() >= 10
      ORDER BY sum(realized_pnl) DESC
      LIMIT 100000
    `,
    format: 'JSONEachRow'
  });

  const profitable = await profitableQuery.json() as any[];
  console.log(`Profitable wallets: ${profitable.length.toLocaleString()}\n`);

  // Step 2: Get wallets active in last 10 days with their max daily trades
  console.log('Step 2: Getting active wallets with daily trade counts (single query)...');

  const activeQuery = await clickhouse.query({
    query: `
      SELECT
        wallet,
        max(daily_count) as max_daily_trades,
        max(last_time) as last_trade,
        sum(daily_count) as total_trades
      FROM (
        SELECT
          trader_wallet as wallet,
          toDate(trade_time) as trade_date,
          count() as daily_count,
          max(trade_time) as last_time
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 30 DAY
        GROUP BY trader_wallet, toDate(trade_time)
      )
      WHERE last_time >= now() - INTERVAL 10 DAY
      GROUP BY wallet
    `,
    format: 'JSONEachRow'
  });

  const activeWallets = await activeQuery.json() as any[];
  console.log(`Wallets active in last 10 days: ${activeWallets.length.toLocaleString()}\n`);

  // Create lookup map
  const activeMap = new Map<string, { maxDailyTrades: number; lastTrade: string; totalTrades: number }>();
  for (const w of activeWallets) {
    activeMap.set(w.wallet, {
      maxDailyTrades: w.max_daily_trades,
      lastTrade: w.last_trade,
      totalTrades: w.total_trades
    });
  }

  // Step 3: Filter and combine
  console.log('Step 3: Combining filters...');

  const humanCandidates = profitable
    .filter(w => {
      const active = activeMap.get(w.wallet);
      if (!active) return false;
      if (active.maxDailyTrades > 200) return false; // Filter out bots
      return true;
    })
    .map(w => {
      const active = activeMap.get(w.wallet)!;
      return {
        ...w,
        maxDailyTrades: active.maxDailyTrades,
        lastTrade: active.lastTrade,
        recentTrades: active.totalTrades
      };
    });

  const botCount = profitable.filter(w => {
    const active = activeMap.get(w.wallet);
    return active && active.maxDailyTrades > 200;
  }).length;

  console.log(`Bot-like wallets filtered out: ${botCount}`);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`FINAL HUMAN CANDIDATES: ${humanCandidates.length.toLocaleString()}`);
  console.log('='.repeat(80));

  // Stats
  const avgPnl = humanCandidates.reduce((sum, w) => sum + w.total_pnl, 0) / humanCandidates.length;
  const avgPositions = humanCandidates.reduce((sum, w) => sum + w.positions, 0) / humanCandidates.length;
  const avgWinRate = humanCandidates.reduce((sum, w) => sum + w.win_rate, 0) / humanCandidates.length;
  const avgMaxDaily = humanCandidates.reduce((sum, w) => sum + w.maxDailyTrades, 0) / humanCandidates.length;

  console.log(`\nAvg PnL: $${avgPnl.toFixed(0)}`);
  console.log(`Avg Positions: ${avgPositions.toFixed(0)}`);
  console.log(`Avg Win Rate: ${(avgWinRate * 100).toFixed(0)}%`);
  console.log(`Avg Max Daily Trades: ${avgMaxDaily.toFixed(0)}`);

  // Distribution by max daily trades
  const daily_1_10 = humanCandidates.filter(w => w.maxDailyTrades >= 1 && w.maxDailyTrades <= 10).length;
  const daily_11_50 = humanCandidates.filter(w => w.maxDailyTrades > 10 && w.maxDailyTrades <= 50).length;
  const daily_51_100 = humanCandidates.filter(w => w.maxDailyTrades > 50 && w.maxDailyTrades <= 100).length;
  const daily_101_200 = humanCandidates.filter(w => w.maxDailyTrades > 100 && w.maxDailyTrades <= 200).length;

  console.log(`\nDistribution by Max Daily Trades:`);
  console.log(`  1-10/day:    ${daily_1_10.toLocaleString()} (most human-like)`);
  console.log(`  11-50/day:   ${daily_11_50.toLocaleString()}`);
  console.log(`  51-100/day:  ${daily_51_100.toLocaleString()}`);
  console.log(`  101-200/day: ${daily_101_200.toLocaleString()}`);

  // Distribution by win rate
  const wr_50_60 = humanCandidates.filter(w => w.win_rate >= 0.50 && w.win_rate < 0.60).length;
  const wr_60_70 = humanCandidates.filter(w => w.win_rate >= 0.60 && w.win_rate < 0.70).length;
  const wr_70_80 = humanCandidates.filter(w => w.win_rate >= 0.70 && w.win_rate < 0.80).length;
  const wr_80_90 = humanCandidates.filter(w => w.win_rate >= 0.80 && w.win_rate < 0.90).length;
  const wr_90_plus = humanCandidates.filter(w => w.win_rate >= 0.90).length;

  console.log(`\nDistribution by Win Rate:`);
  console.log(`  50-60%:  ${wr_50_60.toLocaleString()}`);
  console.log(`  60-70%:  ${wr_60_70.toLocaleString()}`);
  console.log(`  70-80%:  ${wr_70_80.toLocaleString()}`);
  console.log(`  80-90%:  ${wr_80_90.toLocaleString()}`);
  console.log(`  90%+:    ${wr_90_plus.toLocaleString()}`);

  // Distribution by PnL
  const pnl_0_1k = humanCandidates.filter(w => w.total_pnl > 0 && w.total_pnl < 1000).length;
  const pnl_1k_10k = humanCandidates.filter(w => w.total_pnl >= 1000 && w.total_pnl < 10000).length;
  const pnl_10k_100k = humanCandidates.filter(w => w.total_pnl >= 10000 && w.total_pnl < 100000).length;
  const pnl_100k_plus = humanCandidates.filter(w => w.total_pnl >= 100000).length;

  console.log(`\nDistribution by PnL:`);
  console.log(`  $0-$1k:      ${pnl_0_1k.toLocaleString()}`);
  console.log(`  $1k-$10k:    ${pnl_1k_10k.toLocaleString()}`);
  console.log(`  $10k-$100k:  ${pnl_10k_100k.toLocaleString()}`);
  console.log(`  $100k+:      ${pnl_100k_plus.toLocaleString()}`);

  // Top by PnL
  console.log('\n=== TOP 30 BY PNL ===\n');
  console.log('Wallet'.padEnd(44) + 'PnL'.padStart(12) + 'Pos'.padStart(6) + 'WR'.padStart(8) + 'MaxDay'.padStart(8));
  console.log('='.repeat(80));

  for (const w of humanCandidates.slice(0, 30)) {
    console.log(
      w.wallet.padEnd(44) +
      `$${(w.total_pnl / 1000).toFixed(1)}k`.padStart(12) +
      String(w.positions).padStart(6) +
      `${(w.win_rate * 100).toFixed(0)}%`.padStart(8) +
      String(w.maxDailyTrades).padStart(8)
    );
  }

  // Top human-like high performers
  console.log('\n=== TOP 30 HUMAN-LIKE HIGH WIN RATE (20+ pos, <=50 trades/day) ===\n');
  const humanLike = humanCandidates
    .filter(w => w.positions >= 20 && w.maxDailyTrades <= 50)
    .sort((a, b) => b.win_rate - a.win_rate);

  console.log('Wallet'.padEnd(44) + 'WR'.padStart(8) + 'Pos'.padStart(6) + 'PnL'.padStart(12) + 'MaxDay'.padStart(8));
  console.log('='.repeat(80));

  for (const w of humanLike.slice(0, 30)) {
    console.log(
      w.wallet.padEnd(44) +
      `${(w.win_rate * 100).toFixed(0)}%`.padStart(8) +
      String(w.positions).padStart(6) +
      `$${(w.total_pnl / 1000).toFixed(1)}k`.padStart(12) +
      String(w.maxDailyTrades).padStart(8)
    );
  }

  // Best copy trading candidates: good WR + reasonable volume + human patterns
  console.log('\n=== 🎯 BEST COPY TRADING CANDIDATES ===');
  console.log('(70%+ WR, $1k+ PnL, <=30 trades/day, 20+ positions)\n');

  const copyTargets = humanCandidates
    .filter(w =>
      w.win_rate >= 0.70 &&
      w.total_pnl >= 1000 &&
      w.maxDailyTrades <= 30 &&
      w.positions >= 20
    )
    .sort((a, b) => b.win_rate - a.win_rate);

  console.log(`Found ${copyTargets.length} ideal copy trading targets\n`);

  console.log('Wallet'.padEnd(44) + 'WR'.padStart(8) + 'Pos'.padStart(6) + 'PnL'.padStart(12) + 'MaxDay'.padStart(8));
  console.log('='.repeat(80));

  for (const w of copyTargets.slice(0, 50)) {
    console.log(
      w.wallet.padEnd(44) +
      `${(w.win_rate * 100).toFixed(0)}%`.padStart(8) +
      String(w.positions).padStart(6) +
      `$${(w.total_pnl / 1000).toFixed(1)}k`.padStart(12) +
      String(w.maxDailyTrades).padStart(8)
    );
  }

  // Save results
  const fs = await import('fs');
  fs.writeFileSync('/tmp/human-candidates-v4.json', JSON.stringify(humanCandidates, null, 2));
  fs.writeFileSync('/tmp/copy-targets.json', JSON.stringify(copyTargets, null, 2));

  console.log(`\nFull list saved to /tmp/human-candidates-v4.json`);
  console.log(`Copy targets saved to /tmp/copy-targets.json`);
}

main().catch(console.error);
