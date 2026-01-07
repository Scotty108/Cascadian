/**
 * Find "Sniper" Wallets for High-Conviction Copy Trading
 * V2: Uses correct table schemas
 *
 * Criteria:
 * - 85%+ win rate (relaxed from 90% to find more)
 * - 30%+ avg return on wins
 * - 8+ resolved trades
 * - Active in last 60 days
 * - 2+ weeks history
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== SNIPER WALLET FINDER V2 ===');
  console.log('Looking for: 85%+ win rate, 30%+ avg returns, low frequency\n');
  console.log('This query may take 1-2 minutes...\n');

  const query = `
    WITH
    -- Map tokens to conditions and get outcome index
    token_map AS (
      SELECT
        token_id_dec as token_id,
        condition_id,
        outcome_index
      FROM pm_token_to_condition_map_v5
    ),
    -- Get resolved conditions with payout info
    -- payout_numerators is stored as JSON string like '[1,0]'
    resolutions AS (
      SELECT
        condition_id,
        JSONExtract(payout_numerators, 'Array(UInt64)') as payout_arr,
        toUInt64(payout_denominator) as payout_denom,
        resolved_at
      FROM pm_condition_resolutions FINAL
      WHERE is_deleted = 0
        AND payout_denominator != ''
        AND payout_denominator != '0'
    ),
    -- Dedupe trade events
    trades AS (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY event_id
    ),
    -- Join trades with token map and resolutions
    enriched_trades AS (
      SELECT
        t.wallet,
        t.token_id,
        tm.condition_id,
        tm.outcome_index,
        t.side,
        t.usdc,
        t.tokens,
        t.trade_time,
        r.payout_arr,
        r.payout_denom,
        r.resolved_at,
        -- Payout per token: payout_arr[outcome_index+1] / payout_denom
        -- ClickHouse arrays are 1-indexed
        toFloat64(arrayElement(r.payout_arr, toUInt32(tm.outcome_index + 1))) / toFloat64(r.payout_denom) as payout_per_token
      FROM trades t
      INNER JOIN token_map tm ON t.token_id = tm.token_id
      INNER JOIN resolutions r ON tm.condition_id = r.condition_id
    ),
    -- Aggregate to position level (wallet + condition)
    positions AS (
      SELECT
        wallet,
        condition_id,
        -- Net tokens held
        sum(CASE WHEN side = 'BUY' THEN tokens ELSE -tokens END) as net_tokens,
        -- Cost basis (buys only, simplified)
        sum(CASE WHEN side = 'BUY' THEN usdc ELSE 0 END) as cost_basis,
        -- Sell proceeds
        sum(CASE WHEN side = 'SELL' THEN usdc ELSE 0 END) as sell_proceeds,
        -- Payout rate (same for all trades in position)
        any(payout_per_token) as payout_rate,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade,
        any(resolved_at) as resolved_at
      FROM enriched_trades
      GROUP BY wallet, condition_id
      HAVING cost_basis > 1  -- At least $1 invested
    ),
    -- Calculate position outcomes
    position_outcomes AS (
      SELECT
        wallet,
        condition_id,
        cost_basis,
        sell_proceeds,
        net_tokens,
        payout_rate,
        -- Total return = sell proceeds + payout on remaining tokens - cost
        sell_proceeds + (net_tokens * payout_rate) - cost_basis as pnl,
        -- Return %
        (sell_proceeds + (net_tokens * payout_rate) - cost_basis) / cost_basis * 100 as return_pct,
        -- Is win?
        CASE WHEN sell_proceeds + (net_tokens * payout_rate) > cost_basis THEN 1 ELSE 0 END as is_win,
        first_trade,
        last_trade,
        resolved_at
      FROM positions
      WHERE net_tokens >= 0  -- No shorts for simplicity
    ),
    -- Wallet-level aggregation
    wallet_stats AS (
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        sum(is_win) / count() as win_rate,
        avgIf(return_pct, is_win = 1) as avg_win_pct,
        avgIf(abs(return_pct), is_win = 0) as avg_loss_pct,
        sum(pnl) as total_pnl,
        min(first_trade) as first_ever,
        max(last_trade) as last_ever,
        dateDiff('day', min(first_trade), max(last_trade)) + 1 as days_active,
        max(resolved_at) as last_resolution
      FROM position_outcomes
      GROUP BY wallet
    )
    SELECT
      wallet,
      round(win_rate, 3) as win_rate,
      round(avg_win_pct, 1) as avg_win_pct,
      round(coalesce(avg_loss_pct, 0), 1) as avg_loss_pct,
      positions,
      wins,
      round(total_pnl, 2) as total_pnl,
      days_active,
      first_ever,
      last_ever,
      dateDiff('day', last_ever, now()) as days_since_last
    FROM wallet_stats
    WHERE
      win_rate >= 0.85              -- 85%+ win rate
      AND avg_win_pct >= 30         -- 30%+ avg return on wins
      AND positions >= 8            -- 8+ resolved positions
      AND days_active >= 14         -- 2+ weeks history
      AND last_ever >= now() - INTERVAL 60 DAY  -- Active in last 60 days
      AND positions / days_active < 2  -- Not a daily grinder (< 2/day)
    ORDER BY win_rate DESC, avg_win_pct DESC
    LIMIT 50
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length === 0) {
      console.log('No snipers found. Trying with relaxed criteria...\n');
      await findWithRelaxedCriteria();
      return;
    }

    console.log(`Found ${data.length} SNIPER wallets:\n`);
    console.log('='.repeat(100));
    console.log('Wallet'.padEnd(44) + 'Win%'.padStart(8) + 'AvgWin%'.padStart(10) + 'AvgLoss%'.padStart(10) + 'Trades'.padStart(8) + 'PnL'.padStart(12) + 'Last'.padStart(8));
    console.log('='.repeat(100));

    for (const r of data) {
      console.log(
        r.wallet.padEnd(44) +
        `${(r.win_rate * 100).toFixed(1)}%`.padStart(8) +
        `${r.avg_win_pct}%`.padStart(10) +
        `${r.avg_loss_pct}%`.padStart(10) +
        String(r.positions).padStart(8) +
        `$${r.total_pnl}`.padStart(12) +
        `${r.days_since_last}d`.padStart(8)
      );
    }

    console.log('\n=== TOP 10 SNIPER CANDIDATES ===\n');

    for (let i = 0; i < Math.min(10, data.length); i++) {
      const r = data[i];
      const ev = (r.win_rate * r.avg_win_pct / 100) - ((1 - r.win_rate) * r.avg_loss_pct / 100);
      console.log(`${i + 1}. ${r.wallet}`);
      console.log(`   Win Rate:    ${(r.win_rate * 100).toFixed(1)}% (${r.wins}/${r.positions})`);
      console.log(`   Avg Win:     ${r.avg_win_pct}%`);
      console.log(`   Avg Loss:    ${r.avg_loss_pct}%`);
      console.log(`   Total PnL:   $${r.total_pnl}`);
      console.log(`   EV per $1:   $${(ev).toFixed(3)}`);
      console.log(`   Active:      ${r.days_active} days, last trade ${r.days_since_last} days ago`);
      console.log(`   Polymarket:  https://polymarket.com/profile/${r.wallet}`);
      console.log('');
    }
  } catch (err: any) {
    console.error('Query failed:', err.message);
  }
}

async function findWithRelaxedCriteria() {
  // Try even more relaxed criteria to see what's available
  const query = `
    WITH wallet_quick AS (
      SELECT
        trader_wallet as wallet,
        count(DISTINCT event_id) as trades,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 180 DAY
      GROUP BY trader_wallet
      HAVING trades >= 8
    )
    SELECT
      count() as wallets_with_8_plus_trades,
      countIf(dateDiff('day', first_trade, last_trade) >= 14) as with_14_day_history,
      countIf(last_trade >= now() - INTERVAL 60 DAY) as active_last_60d
    FROM wallet_quick
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];
  console.log('Pool sizes:', data[0]);
  console.log('\nNote: The full sniper calculation requires joining with resolutions table.');
  console.log('Consider running the overnight metrics job to populate pm_copy_trading_metrics_v1 with correct dates.');
}

main().catch(console.error);
