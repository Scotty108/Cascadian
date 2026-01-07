/**
 * Find Human Copy-Trading Candidates - V2
 * Use precomputed table for speed, filter:
 * 1. PnL > 0 (profitable)
 * 2. Active in last 10 days
 * 3. More than 10 trades
 * 4. No external redemptions (CLOB-only)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== FINDING HUMAN COPY-TRADING CANDIDATES V2 ===\n');

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

  // Step 2: Check which are active in last 10 days
  console.log('Step 2: Filtering for activity in last 10 days...');

  const walletList = profitable.map(w => w.wallet);

  // Batch check for recent activity
  const batchSize = 5000;
  const activeWallets: Set<string> = new Set();

  for (let i = 0; i < walletList.length; i += batchSize) {
    const batch = walletList.slice(i, i + batchSize);

    const activeQuery = await clickhouse.query({
      query: `
        SELECT DISTINCT trader_wallet as wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 10 DAY
          AND trader_wallet IN (${batch.map(w => `'${w}'`).join(',')})
      `,
      format: 'JSONEachRow'
    });

    const active = await activeQuery.json() as any[];
    active.forEach((a: any) => activeWallets.add(a.wallet));

    process.stdout.write(`\r  Checked ${Math.min(i + batchSize, walletList.length)}/${walletList.length} (found ${activeWallets.size} active)`);
  }

  console.log(`\n\nActive in last 10 days: ${activeWallets.size.toLocaleString()}\n`);

  // Step 3: Filter out wallets with external redemptions
  console.log('Step 3: Filtering out wallets with external redemptions...');

  const activeList = Array.from(activeWallets);
  const burnersSet: Set<string> = new Set();

  for (let i = 0; i < activeList.length; i += batchSize) {
    const batch = activeList.slice(i, i + batchSize);

    const burnersQuery = await clickhouse.query({
      query: `
        SELECT DISTINCT lower(from_address) as wallet
        FROM pm_erc1155_transfers
        WHERE is_deleted = 0
          AND lower(to_address) = '0x0000000000000000000000000000000000000000'
          AND lower(from_address) IN (${batch.map(w => `'${w}'`).join(',')})
      `,
      format: 'JSONEachRow'
    });

    const burners = await burnersQuery.json() as any[];
    burners.forEach((b: any) => burnersSet.add(b.wallet));

    process.stdout.write(`\r  Checked ${Math.min(i + batchSize, activeList.length)}/${activeList.length} (found ${burnersSet.size} with redemptions)`);
  }

  console.log(`\n\nWallets with external redemptions: ${burnersSet.size}`);

  // Final filtered list
  const finalCandidates = profitable.filter(w =>
    activeWallets.has(w.wallet) && !burnersSet.has(w.wallet)
  );

  console.log(`\n${'='.repeat(80)}`);
  console.log(`FINAL HUMAN CANDIDATES: ${finalCandidates.length.toLocaleString()}`);
  console.log('='.repeat(80));

  // Stats
  const avgPnl = finalCandidates.reduce((sum, w) => sum + w.total_pnl, 0) / finalCandidates.length;
  const avgPositions = finalCandidates.reduce((sum, w) => sum + w.positions, 0) / finalCandidates.length;
  const avgWinRate = finalCandidates.reduce((sum, w) => sum + w.win_rate, 0) / finalCandidates.length;

  console.log(`\nAvg PnL: $${avgPnl.toFixed(0)}`);
  console.log(`Avg Positions: ${avgPositions.toFixed(0)}`);
  console.log(`Avg Win Rate: ${(avgWinRate * 100).toFixed(0)}%`);

  // Distribution by PnL
  const pnl_100_1k = finalCandidates.filter(w => w.total_pnl >= 100 && w.total_pnl < 1000).length;
  const pnl_1k_10k = finalCandidates.filter(w => w.total_pnl >= 1000 && w.total_pnl < 10000).length;
  const pnl_10k_100k = finalCandidates.filter(w => w.total_pnl >= 10000 && w.total_pnl < 100000).length;
  const pnl_100k_plus = finalCandidates.filter(w => w.total_pnl >= 100000).length;

  console.log(`\nDistribution by PnL:`);
  console.log(`  $100-$1k:    ${pnl_100_1k.toLocaleString()}`);
  console.log(`  $1k-$10k:    ${pnl_1k_10k.toLocaleString()}`);
  console.log(`  $10k-$100k:  ${pnl_10k_100k.toLocaleString()}`);
  console.log(`  $100k+:      ${pnl_100k_plus.toLocaleString()}`);

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

  // Top by PnL
  console.log('\n=== TOP 30 BY PNL ===\n');
  console.log('Wallet'.padEnd(44) + 'PnL'.padStart(12) + 'Pos'.padStart(6) + 'Wins'.padStart(6) + 'WR'.padStart(8));
  console.log('='.repeat(80));

  for (const w of finalCandidates.slice(0, 30)) {
    console.log(
      w.wallet.padEnd(44) +
      `$${(w.total_pnl / 1000).toFixed(1)}k`.padStart(12) +
      String(w.positions).padStart(6) +
      String(w.wins).padStart(6) +
      `${(w.win_rate * 100).toFixed(0)}%`.padStart(8)
    );
  }

  // Top by win rate (minimum 20 positions)
  console.log('\n=== TOP 30 BY WIN RATE (20+ positions) ===\n');
  const byWinRate = finalCandidates
    .filter(w => w.positions >= 20)
    .sort((a, b) => b.win_rate - a.win_rate);

  console.log('Wallet'.padEnd(44) + 'WR'.padStart(8) + 'Pos'.padStart(6) + 'Wins'.padStart(6) + 'PnL'.padStart(12));
  console.log('='.repeat(80));

  for (const w of byWinRate.slice(0, 30)) {
    console.log(
      w.wallet.padEnd(44) +
      `${(w.win_rate * 100).toFixed(0)}%`.padStart(8) +
      String(w.positions).padStart(6) +
      String(w.wins).padStart(6) +
      `$${(w.total_pnl / 1000).toFixed(1)}k`.padStart(12)
    );
  }

  // Save results
  const fs = await import('fs');
  fs.writeFileSync(
    '/tmp/human-candidates-v2.json',
    JSON.stringify(finalCandidates, null, 2)
  );
  console.log(`\nFull list saved to /tmp/human-candidates-v2.json`);

  // Output all addresses
  console.log(`\n=== ALL ${finalCandidates.length} CANDIDATE ADDRESSES ===\n`);
  console.log('(First 50 shown)');
  for (const w of finalCandidates.slice(0, 50)) {
    console.log(`${w.wallet} | PnL: $${w.total_pnl.toFixed(0)} | ${w.wins}/${w.positions} (${(w.win_rate * 100).toFixed(0)}%)`);
  }
}

main().catch(console.error);
