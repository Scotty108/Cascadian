/**
 * Find Human Copy-Trading Candidates - V7
 * ALIGNED WITH CCR-v1 ELIGIBILITY: Only filter wallets that RECEIVED ERC1155 tokens
 *
 * Per CCR-v1 engine (line 57-67):
 * - CTF events (redemptions, splits, merges) = OK (known prices)
 * - RECEIVING ERC1155 tokens = NOT OK (unknown cost basis)
 * - SENDING tokens (including burns) = OK (we know the cost basis)
 *
 * Filters:
 * 1. PnL > 0 (profitable)
 * 2. Active in last 10 days
 * 3. More than 10 trades
 * 4. Max 200 trades/day (not bots)
 * 5. NO ERC1155 token RECEIPTS (but sends/burns are OK!)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== FINDING HUMAN COPY-TRADING CANDIDATES V7 ===\n');
  console.log('ALIGNED WITH CCR-v1: Only filter wallets that RECEIVED ERC1155 tokens\n');
  console.log('- Burns (redemptions to 0x0) = OK\n');
  console.log('- Sends to other wallets = OK (we have cost basis)\n');
  console.log('- RECEIVES from other wallets = NOT OK (unknown cost basis)\n');
  console.log('Filters: PnL > 0, 10+ trades, active 10 days, max 200/day\n');

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

  // Step 2: Get wallets active in last 10 days with daily trade counts
  console.log('Step 2: Getting active wallets with daily trade counts...');

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

  const activeMap = new Map<string, { maxDailyTrades: number; lastTrade: string; totalTrades: number }>();
  for (const w of activeWallets) {
    activeMap.set(w.wallet, {
      maxDailyTrades: w.max_daily_trades,
      lastTrade: w.last_trade,
      totalTrades: w.total_trades
    });
  }

  // Step 3: Get wallets that RECEIVED ERC1155 tokens (per CCR-v1 eligibility check)
  // Sending tokens (including burns) is OK - we track the original buy via CLOB
  console.log('Step 3: Finding wallets that RECEIVED ERC1155 tokens (to exclude)...');
  console.log('        (Per CCR-v1: sends/burns are OK, only RECEIVES break PnL)');

  const receivedQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(to_address) as wallet
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0
        -- Not a mint (from 0x0)
        AND lower(from_address) != '0x0000000000000000000000000000000000000000'
        -- Not a burn (to 0x0) - but these are fine, we're filtering RECEIVEs
        AND lower(to_address) != '0x0000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  });

  const receivedWallets = new Set((await receivedQuery.json() as any[]).map(w => w.wallet));
  console.log(`Wallets that RECEIVED ERC1155 tokens: ${receivedWallets.size.toLocaleString()}\n`);

  // Compare to V5/V6 for reference
  const allCtfQuery = await clickhouse.query({
    query: `
      SELECT count(distinct wallet) as cnt FROM (
        SELECT DISTINCT lower(from_address) as wallet FROM pm_erc1155_transfers WHERE is_deleted = 0
        UNION DISTINCT
        SELECT DISTINCT lower(to_address) as wallet FROM pm_erc1155_transfers WHERE is_deleted = 0
      )
    `,
    format: 'JSONEachRow'
  });
  const allCtf = (await allCtfQuery.json() as any[])[0];
  console.log(`(For reference: ALL wallets with ANY CTF events: ${allCtf?.cnt?.toLocaleString()})\n`);

  // Step 4: Combine all filters
  console.log('Step 4: Applying all filters...');

  let botCount = 0;
  let receivedCount = 0;
  let notActiveCount = 0;

  const humanCandidates = profitable.filter(w => {
    const active = activeMap.get(w.wallet);

    if (!active) {
      notActiveCount++;
      return false;
    }

    if (active.maxDailyTrades > 200) {
      botCount++;
      return false;
    }

    if (receivedWallets.has(w.wallet)) {
      receivedCount++;
      return false;
    }

    return true;
  }).map(w => {
    const active = activeMap.get(w.wallet)!;
    return {
      ...w,
      maxDailyTrades: active.maxDailyTrades,
      lastTrade: active.lastTrade,
      recentTrades: active.totalTrades
    };
  });

  console.log(`Filtered out - Not active: ${notActiveCount.toLocaleString()}`);
  console.log(`Filtered out - Bot-like (>200/day): ${botCount.toLocaleString()}`);
  console.log(`Filtered out - Received ERC1155 tokens: ${receivedCount.toLocaleString()}`);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`FINAL HUMAN CANDIDATES (CCR-v1 eligible): ${humanCandidates.length.toLocaleString()}`);
  console.log('='.repeat(80));

  if (humanCandidates.length === 0) {
    console.log('\nNo candidates found with all filters.');
    return;
  }

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

  // Best copy trading candidates
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
  fs.writeFileSync('/tmp/human-candidates-v7.json', JSON.stringify(humanCandidates, null, 2));
  fs.writeFileSync('/tmp/copy-targets-v7.json', JSON.stringify(copyTargets, null, 2));

  console.log(`\nFull list saved to /tmp/human-candidates-v7.json`);
  console.log(`Copy targets saved to /tmp/copy-targets-v7.json`);

  // Summary comparison
  console.log(`\n=== VERSION COMPARISON ===`);
  console.log(`V5 (no CTF at all):            15,715 candidates, 44 copy targets`);
  console.log(`V6 (no W2W transfers):         16,370 candidates, 43 copy targets`);
  console.log(`V7 (CCR-v1 aligned - RX only): ${humanCandidates.length.toLocaleString()} candidates, ${copyTargets.length} copy targets`);
}

main().catch(console.error);
