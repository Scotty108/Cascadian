/**
 * Find Human Copy-Trading Candidates - V3
 * Filter:
 * 1. PnL > 0 (profitable)
 * 2. Active in last 10 days
 * 3. More than 10 trades
 * 4. No more than 200 trades per day (filter out bots)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== FINDING HUMAN COPY-TRADING CANDIDATES V3 ===\n');
  console.log('Filters: PnL > 0, 10+ trades, active 10 days, max 200 trades/day\n');

  // Step 1: Get profitable wallets from precomputed table
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
  console.log(`Profitable wallets with 10+ positions: ${profitable.length.toLocaleString()}\n`);

  // Step 2: Check for bot-like behavior (>200 trades/day) and recent activity
  console.log('Step 2: Filtering for human trading patterns (max 200 trades/day) + active 10 days...');

  const walletList = profitable.map(w => w.wallet);
  const batchSize = 2000;

  const humanWallets: Map<string, { maxDailyTrades: number; lastTrade: string }> = new Map();
  const botWallets: Set<string> = new Set();

  for (let i = 0; i < walletList.length; i += batchSize) {
    const batch = walletList.slice(i, i + batchSize);

    const query = await clickhouse.query({
      query: `
        SELECT
          wallet,
          max(daily_trades) as max_daily_trades,
          max(last_trade) as last_trade
        FROM (
          SELECT
            wallet,
            toDate(trade_time) as trade_date,
            count() as daily_trades,
            max(trade_time) as last_trade
          FROM (
            SELECT event_id, any(trader_wallet) as wallet, any(trade_time) as trade_time
            FROM pm_trader_events_v2
            WHERE is_deleted = 0
            GROUP BY event_id
          )
          WHERE wallet IN (${batch.map(w => `'${w}'`).join(',')})
          GROUP BY wallet, trade_date
        )
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    });

    const results = await query.json() as any[];

    for (const r of results) {
      const lastTradeDate = new Date(r.last_trade);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      if (r.max_daily_trades > 200) {
        botWallets.add(r.wallet);
      } else if (lastTradeDate >= tenDaysAgo) {
        humanWallets.set(r.wallet, {
          maxDailyTrades: r.max_daily_trades,
          lastTrade: r.last_trade
        });
      }
    }

    process.stdout.write(`\r  Checked ${Math.min(i + batchSize, walletList.length)}/${walletList.length} | Humans: ${humanWallets.size} | Bots: ${botWallets.size}`);
  }

  console.log(`\n\nBot-like wallets (>200 trades/day): ${botWallets.size}`);
  console.log(`Human-pattern wallets (active, <=200/day): ${humanWallets.size}\n`);

  // Final filtered list with metrics
  const finalCandidates = profitable
    .filter(w => humanWallets.has(w.wallet))
    .map(w => ({
      ...w,
      maxDailyTrades: humanWallets.get(w.wallet)!.maxDailyTrades,
      lastTrade: humanWallets.get(w.wallet)!.lastTrade
    }));

  console.log('='.repeat(80));
  console.log(`FINAL HUMAN CANDIDATES: ${finalCandidates.length.toLocaleString()}`);
  console.log('='.repeat(80));

  // Stats
  const avgPnl = finalCandidates.reduce((sum, w) => sum + w.total_pnl, 0) / finalCandidates.length;
  const avgPositions = finalCandidates.reduce((sum, w) => sum + w.positions, 0) / finalCandidates.length;
  const avgWinRate = finalCandidates.reduce((sum, w) => sum + w.win_rate, 0) / finalCandidates.length;
  const avgMaxDaily = finalCandidates.reduce((sum, w) => sum + w.maxDailyTrades, 0) / finalCandidates.length;

  console.log(`\nAvg PnL: $${avgPnl.toFixed(0)}`);
  console.log(`Avg Positions: ${avgPositions.toFixed(0)}`);
  console.log(`Avg Win Rate: ${(avgWinRate * 100).toFixed(0)}%`);
  console.log(`Avg Max Daily Trades: ${avgMaxDaily.toFixed(0)}`);

  // Distribution by max daily trades
  const daily_1_10 = finalCandidates.filter(w => w.maxDailyTrades >= 1 && w.maxDailyTrades <= 10).length;
  const daily_11_50 = finalCandidates.filter(w => w.maxDailyTrades > 10 && w.maxDailyTrades <= 50).length;
  const daily_51_100 = finalCandidates.filter(w => w.maxDailyTrades > 50 && w.maxDailyTrades <= 100).length;
  const daily_101_200 = finalCandidates.filter(w => w.maxDailyTrades > 100 && w.maxDailyTrades <= 200).length;

  console.log(`\nDistribution by Max Daily Trades:`);
  console.log(`  1-10/day:    ${daily_1_10.toLocaleString()} (most human-like)`);
  console.log(`  11-50/day:   ${daily_11_50.toLocaleString()}`);
  console.log(`  51-100/day:  ${daily_51_100.toLocaleString()}`);
  console.log(`  101-200/day: ${daily_101_200.toLocaleString()}`);

  // Distribution by win rate
  const wr_50_60 = finalCandidates.filter(w => w.win_rate >= 0.50 && w.win_rate < 0.60).length;
  const wr_60_70 = finalCandidates.filter(w => w.win_rate >= 0.60 && w.win_rate < 0.70).length;
  const wr_70_80 = finalCandidates.filter(w => w.win_rate >= 0.70 && w.win_rate < 0.80).length;
  const wr_80_90 = finalCandidates.filter(w => w.win_rate >= 0.80 && w.win_rate < 0.90).length;
  const wr_90_plus = finalCandidates.filter(w => w.win_rate >= 0.90).length;

  console.log(`\nDistribution by Win Rate:`);
  console.log(`  50-60%:  ${wr_50_60.toLocaleString()}`);
  console.log(`  60-70%:  ${wr_60_70.toLocaleString()}`);
  console.log(`  70-80%:  ${wr_70_80.toLocaleString()}`);
  console.log(`  80-90%:  ${wr_80_90.toLocaleString()}`);
  console.log(`  90%+:    ${wr_90_plus.toLocaleString()}`);

  // Distribution by PnL
  const pnl_0_1k = finalCandidates.filter(w => w.total_pnl > 0 && w.total_pnl < 1000).length;
  const pnl_1k_10k = finalCandidates.filter(w => w.total_pnl >= 1000 && w.total_pnl < 10000).length;
  const pnl_10k_100k = finalCandidates.filter(w => w.total_pnl >= 10000 && w.total_pnl < 100000).length;
  const pnl_100k_plus = finalCandidates.filter(w => w.total_pnl >= 100000).length;

  console.log(`\nDistribution by PnL:`);
  console.log(`  $0-$1k:      ${pnl_0_1k.toLocaleString()}`);
  console.log(`  $1k-$10k:    ${pnl_1k_10k.toLocaleString()}`);
  console.log(`  $10k-$100k:  ${pnl_10k_100k.toLocaleString()}`);
  console.log(`  $100k+:      ${pnl_100k_plus.toLocaleString()}`);

  // Top by PnL
  console.log('\n=== TOP 30 BY PNL ===\n');
  console.log('Wallet'.padEnd(44) + 'PnL'.padStart(12) + 'Pos'.padStart(6) + 'WR'.padStart(8) + 'MaxDay'.padStart(8));
  console.log('='.repeat(80));

  for (const w of finalCandidates.slice(0, 30)) {
    console.log(
      w.wallet.padEnd(44) +
      `$${(w.total_pnl / 1000).toFixed(1)}k`.padStart(12) +
      String(w.positions).padStart(6) +
      `${(w.win_rate * 100).toFixed(0)}%`.padStart(8) +
      String(w.maxDailyTrades).padStart(8)
    );
  }

  // Top by win rate (minimum 20 positions, max 50 trades/day for human-like)
  console.log('\n=== TOP 30 HUMAN-LIKE HIGH WIN RATE (20+ pos, <=50 trades/day) ===\n');
  const humanLike = finalCandidates
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

  // Save results
  const fs = await import('fs');
  fs.writeFileSync(
    '/tmp/human-candidates-v3.json',
    JSON.stringify(finalCandidates, null, 2)
  );
  console.log(`\nFull list saved to /tmp/human-candidates-v3.json`);

  // Output summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total human candidates: ${finalCandidates.length.toLocaleString()}`);
  console.log(`Most human-like (<=10 trades/day): ${daily_1_10.toLocaleString()}`);
  console.log(`High performers (90%+ WR): ${wr_90_plus.toLocaleString()}`);
  console.log(`Big winners ($100k+ PnL): ${pnl_100k_plus.toLocaleString()}`);
}

main().catch(console.error);
