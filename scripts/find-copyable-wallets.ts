/**
 * Find Best Wallets for Equal-Weight $1 Copy Trading
 *
 * Based on the Platinum 12 selection criteria:
 * - Asymmetry > 4 (avg_win_pct / avg_loss_pct)
 * - Positive EV at $1/trade
 * - 30+ days active
 * - 0.1-50 trades/day
 * - Not a phantom wallet
 *
 * Usage:
 *   npx tsx scripts/find-copyable-wallets.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

interface CopyableWallet {
  wallet_address: string;
  win_rate: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  asymmetry: number;
  ev_per_trade: number;
  days_active: number;
  trades_per_day: number;
  edge_ratio: number;
  realized_pnl: number;
  resolved_positions: number;
}

async function main() {
  console.log('=== Finding Best Wallets for Equal-Weight Copy Trading ===\n');

  // First, check if table exists and has data
  const countQuery = `
    SELECT count() as cnt FROM pm_copy_trading_metrics_v1 FINAL
  `;

  try {
    const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
    const countRows = await countResult.json() as { cnt: string }[];
    const totalWallets = Number(countRows[0]?.cnt || 0);

    if (totalWallets === 0) {
      console.log('❌ pm_copy_trading_metrics_v1 is empty!');
      console.log('   Run the overnight computation first:');
      console.log('   npx tsx scripts/leaderboard/compute-full-metrics-overnight.ts');
      return;
    }

    console.log(`📊 Total wallets in metrics table: ${totalWallets.toLocaleString()}\n`);
  } catch (error) {
    console.log('❌ Error checking table. It may not exist yet.');
    console.log('   Create it with: clickhouse-client < sql/ddl_pm_copy_trading_metrics_v1.sql');
    console.log('   Then run: npx tsx scripts/leaderboard/compute-full-metrics-overnight.ts');
    return;
  }

  // Main query
  const query = `
    SELECT
      wallet_address,
      win_rate,
      avg_win_pct,
      avg_loss_pct,
      avg_win_pct / nullIf(avg_loss_pct, 0) AS asymmetry,
      (win_rate * avg_win_pct) - ((1 - win_rate) * avg_loss_pct) AS ev_per_trade,
      days_active,
      total_trades / nullIf(days_active, 0) AS trades_per_day,
      edge_ratio,
      realized_pnl,
      resolved_positions
    FROM pm_copy_trading_metrics_v1 FINAL
    WHERE
      -- Asymmetry > 4 (safety margin for all win rates)
      avg_win_pct / nullIf(avg_loss_pct, 0) > 4
      -- Positive EV at equal weight
      AND (win_rate * avg_win_pct) > ((1 - win_rate) * avg_loss_pct)
      -- Active 30+ days
      AND days_active >= 30
      -- Copyable frequency
      AND total_trades / nullIf(days_active, 0) BETWEEN 0.1 AND 50
      -- Not phantom
      AND is_phantom = 0
      -- Statistical significance
      AND resolved_positions >= 50
    ORDER BY ev_per_trade DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as CopyableWallet[];

  if (wallets.length === 0) {
    console.log('No wallets match the criteria. Trying looser filters...\n');

    // Try looser filter
    const looseQuery = `
      SELECT
        wallet_address,
        win_rate,
        avg_win_pct,
        avg_loss_pct,
        avg_win_pct / nullIf(avg_loss_pct, 0) AS asymmetry,
        days_active,
        total_trades / nullIf(days_active, 0) AS trades_per_day,
        edge_ratio
      FROM pm_copy_trading_metrics_v1 FINAL
      WHERE avg_win_pct / nullIf(avg_loss_pct, 0) > 2
        AND days_active >= 7
      ORDER BY asymmetry DESC
      LIMIT 20
    `;

    const looseResult = await clickhouse.query({ query: looseQuery, format: 'JSONEachRow' });
    const looseWallets = await looseResult.json() as any[];

    console.log(`Found ${looseWallets.length} wallets with looser filters (asymmetry > 2, 7+ days):\n`);
    console.log('Wallet                                     | Asym  | WinRate | Days | Trades/Day');
    console.log('-------------------------------------------|-------|---------|------|----------');

    for (const w of looseWallets) {
      console.log(
        `${w.wallet_address} | ` +
        `${Number(w.asymmetry).toFixed(1).padStart(5)} | ` +
        `${(Number(w.win_rate) * 100).toFixed(0).padStart(5)}% | ` +
        `${String(w.days_active).padStart(4)} | ` +
        `${Number(w.trades_per_day).toFixed(1).padStart(9)}`
      );
    }
    return;
  }

  console.log(`✅ Found ${wallets.length} wallets matching criteria:\n`);
  console.log('Filters applied:');
  console.log('  - Asymmetry > 4 (wins are 4x+ larger than losses)');
  console.log('  - Positive EV per $1 trade');
  console.log('  - 30+ days active');
  console.log('  - 0.1-50 trades/day');
  console.log('  - Not phantom (no external token sources)');
  console.log('  - 50+ resolved positions\n');

  console.log('Wallet                                     | Asym  | WinRate | EV/$1  | Days | Trades/Day | PnL');
  console.log('-------------------------------------------|-------|---------|--------|------|------------|--------');

  for (const w of wallets) {
    console.log(
      `${w.wallet_address} | ` +
      `${Number(w.asymmetry).toFixed(1).padStart(5)} | ` +
      `${(Number(w.win_rate) * 100).toFixed(0).padStart(5)}% | ` +
      `$${Number(w.ev_per_trade).toFixed(2).padStart(5)} | ` +
      `${String(w.days_active).padStart(4)} | ` +
      `${Number(w.trades_per_day).toFixed(1).padStart(10)} | ` +
      `$${Number(w.realized_pnl).toFixed(0).padStart(6)}`
    );
  }

  // Summary stats
  console.log('\n=== Summary ===\n');
  const avgAsym = wallets.reduce((a, w) => a + Number(w.asymmetry), 0) / wallets.length;
  const avgEv = wallets.reduce((a, w) => a + Number(w.ev_per_trade), 0) / wallets.length;
  const avgWinRate = wallets.reduce((a, w) => a + Number(w.win_rate), 0) / wallets.length;

  console.log(`Average Asymmetry: ${avgAsym.toFixed(2)}`);
  console.log(`Average EV/Trade: $${avgEv.toFixed(2)}`);
  console.log(`Average Win Rate: ${(avgWinRate * 100).toFixed(0)}%`);

  console.log('\n=== Formula Reminder ===\n');
  console.log('For equal-weight $1 copy trading to profit:');
  console.log('  Asymmetry > (1 - WinRate) / WinRate');
  console.log('');
  console.log('Using Asymmetry > 4 ensures profitability for:');
  console.log('  - 20% win rate: needs > 4.0 ✓');
  console.log('  - 50% win rate: needs > 1.0 ✓');
  console.log('  - 75% win rate: needs > 0.33 ✓');
}

main().catch(console.error);
