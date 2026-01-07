/**
 * Find "Sniper" Wallets for High-Conviction Copy Trading
 *
 * These are superforecaster/insider-type wallets:
 * - 90%+ win rate
 * - Fat returns per trade (avg win >= 50%)
 * - Low frequency (not daily grinders)
 * - 8+ trades minimum (statistical floor)
 * - Recent activity (still active)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== SNIPER WALLET FINDER ===');
  console.log('Looking for: 90%+ win rate, fat returns, low frequency\n');

  // First check if pm_copy_trading_metrics_v1 has data
  const checkTable = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_copy_trading_metrics_v1`,
    format: 'JSONEachRow',
  });
  const rows = await checkTable.json() as any[];
  const tableCount = rows[0]?.cnt || 0;

  if (tableCount > 0) {
    console.log(`pm_copy_trading_metrics_v1 has ${tableCount} rows - using precomputed metrics\n`);
    await findSnipersFromMetrics();
  } else {
    console.log('pm_copy_trading_metrics_v1 is empty - computing from raw trades\n');
    await findSnipersFromRaw();
  }
}

async function findSnipersFromMetrics() {
  const query = `
    SELECT
      wallet_address,
      win_rate,
      avg_win_pct,
      avg_loss_pct,
      total_trades,
      resolved_positions,
      days_active,
      resolved_positions / nullIf(days_active, 0) as trades_per_day,
      edge_ratio,
      last_trade
    FROM pm_copy_trading_metrics_v1 FINAL
    WHERE
      win_rate >= 0.90                          -- 90%+ win rate
      AND avg_win_pct >= 50                     -- Fat returns (50%+ avg win)
      AND resolved_positions >= 8               -- Minimum sample
      AND resolved_positions / nullIf(days_active, 0) < 2  -- Low frequency (< 2/day)
      AND days_active >= 14                     -- 2+ weeks history
      AND is_phantom = 0                        -- Clean wallet
      AND last_trade >= now() - INTERVAL 30 DAY  -- Active recently
    ORDER BY
      win_rate DESC,
      avg_win_pct DESC
    LIMIT 100
  `;

  console.log('Running query on precomputed metrics...\n');
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  printResults(data);
}

async function findSnipersFromRaw() {
  // Compute from pm_trader_events_v2 using position-level aggregation
  // This is an approximation - true PnL needs CCR-v1 engine
  const query = `
    WITH
    -- Dedupe events first (pm_trader_events_v2 has duplicates)
    deduped AS (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        any(condition_id) as condition_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens,
        any(trade_time) as trade_time,
        any(price) as price
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY event_id
    ),
    -- Get resolution outcomes
    resolutions AS (
      SELECT
        condition_id,
        winning_outcome
      FROM pm_condition_resolutions_v1 FINAL
      WHERE winning_outcome IS NOT NULL
    ),
    -- Calculate position-level returns
    positions AS (
      SELECT
        d.wallet,
        d.condition_id,
        -- Simplified: sum buys, check if resolved to winning side
        sum(CASE WHEN d.side = 'BUY' THEN d.usdc ELSE 0 END) as cost_basis,
        sum(CASE WHEN d.side = 'BUY' THEN d.tokens ELSE 0 END) as tokens_bought,
        sum(CASE WHEN d.side = 'SELL' THEN d.usdc ELSE 0 END) as sell_proceeds,
        min(d.trade_time) as first_trade,
        max(d.trade_time) as last_trade,
        r.winning_outcome
      FROM deduped d
      LEFT JOIN resolutions r ON d.condition_id = r.condition_id
      WHERE r.winning_outcome IS NOT NULL  -- Only resolved positions
      GROUP BY d.wallet, d.condition_id, r.winning_outcome
      HAVING cost_basis > 0
    ),
    -- Determine win/loss per position (simplified)
    position_outcomes AS (
      SELECT
        wallet,
        condition_id,
        cost_basis,
        -- If they held YES tokens and YES won, or NO tokens and NO won = win
        -- Simplified: assume they won if tokens_bought * winning_outcome > cost_basis
        CASE
          WHEN (tokens_bought * winning_outcome + sell_proceeds) > cost_basis THEN 1
          ELSE 0
        END as is_win,
        -- Return % = (value_at_resolution - cost_basis) / cost_basis
        ((tokens_bought * winning_outcome + sell_proceeds) - cost_basis) / nullIf(cost_basis, 0) * 100 as return_pct,
        first_trade,
        last_trade
      FROM positions
    ),
    -- Aggregate to wallet level
    wallet_stats AS (
      SELECT
        wallet,
        count() as total_positions,
        sum(is_win) as wins,
        sum(is_win) / count() as win_rate,
        avgIf(return_pct, is_win = 1) as avg_win_pct,
        avgIf(abs(return_pct), is_win = 0) as avg_loss_pct,
        min(first_trade) as first_trade_ever,
        max(last_trade) as last_trade_ever,
        dateDiff('day', min(first_trade), max(last_trade)) + 1 as days_active
      FROM position_outcomes
      GROUP BY wallet
    )
    SELECT
      wallet,
      win_rate,
      round(avg_win_pct, 2) as avg_win_pct,
      round(avg_loss_pct, 2) as avg_loss_pct,
      total_positions,
      wins,
      days_active,
      round(total_positions / nullIf(days_active, 0), 2) as trades_per_day,
      first_trade_ever,
      last_trade_ever
    FROM wallet_stats
    WHERE
      win_rate >= 0.90                              -- 90%+ win rate
      AND avg_win_pct >= 50                         -- Fat returns
      AND total_positions >= 8                      -- Minimum sample
      AND total_positions / nullIf(days_active, 0) < 2  -- Low frequency
      AND days_active >= 14                         -- 2+ weeks history
      AND last_trade_ever >= now() - INTERVAL 30 DAY    -- Active recently
    ORDER BY win_rate DESC, avg_win_pct DESC
    LIMIT 100
  `;

  console.log('Computing from raw trades (this may take a while)...\n');

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];
    printResults(data);
  } catch (err: any) {
    console.error('Query failed:', err.message);
    console.log('\nThe raw computation is complex. Consider running the overnight metrics job first:');
    console.log('npx tsx scripts/leaderboard/compute-full-metrics-overnight.ts');
  }
}

function printResults(data: any[]) {
  if (!data || data.length === 0) {
    console.log('No snipers found matching criteria.');
    return;
  }

  console.log(`Found ${data.length} SNIPER wallets:\n`);
  console.log('Wallet'.padEnd(44) + 'Win%'.padStart(8) + 'AvgWin%'.padStart(10) + 'Trades'.padStart(8) + 'Freq/Day'.padStart(10) + 'Days'.padStart(6));
  console.log('-'.repeat(86));

  for (const row of data) {
    const wallet = row.wallet || row.wallet_address;
    const winRate = (parseFloat(row.win_rate) * 100).toFixed(1) + '%';
    const avgWin = parseFloat(row.avg_win_pct).toFixed(1) + '%';
    const trades = row.total_positions || row.resolved_positions;
    const freq = parseFloat(row.trades_per_day).toFixed(2);
    const days = row.days_active;

    console.log(
      wallet.padEnd(44) +
      winRate.padStart(8) +
      avgWin.padStart(10) +
      String(trades).padStart(8) +
      freq.padStart(10) +
      String(days).padStart(6)
    );
  }

  console.log('\n=== TOP 10 SNIPER CANDIDATES ===\n');

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    const wallet = row.wallet || row.wallet_address;
    console.log(`${i + 1}. ${wallet}`);
    console.log(`   Win Rate: ${(parseFloat(row.win_rate) * 100).toFixed(1)}%`);
    console.log(`   Avg Win:  ${parseFloat(row.avg_win_pct).toFixed(1)}%`);
    console.log(`   Avg Loss: ${parseFloat(row.avg_loss_pct || 0).toFixed(1)}%`);
    console.log(`   Trades:   ${row.total_positions || row.resolved_positions} over ${row.days_active} days`);
    console.log(`   Polymarket: https://polymarket.com/profile/${wallet}`);
    console.log('');
  }
}

main().catch(console.error);
