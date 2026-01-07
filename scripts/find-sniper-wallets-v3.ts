/**
 * Find "Sniper" Wallets - V3 Simplified
 * Uses simpler query structure to avoid CTE scoping issues
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== SNIPER WALLET FINDER V3 ===');
  console.log('Looking for: 85%+ win rate, 30%+ avg returns\n');
  console.log('Running query (may take 1-2 min)...\n');

  // Step 1: Get position-level PnL for all wallets
  const query = `
    SELECT
      wallet,
      round(wins / positions, 3) as win_rate,
      round(avg_win_pct, 1) as avg_win_pct,
      round(coalesce(avg_loss_pct, 0), 1) as avg_loss_pct,
      positions,
      wins,
      round(total_pnl, 2) as total_pnl,
      days_active,
      days_since_last
    FROM (
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        avgIf(return_pct, is_win = 1) as avg_win_pct,
        avgIf(abs(return_pct), is_win = 0) as avg_loss_pct,
        sum(pnl) as total_pnl,
        dateDiff('day', min(first_trade), max(last_trade)) + 1 as days_active,
        dateDiff('day', max(last_trade), now()) as days_since_last
      FROM (
        SELECT
          wallet,
          cond_id,
          cost_basis,
          sell_proceeds,
          net_tokens,
          payout_rate,
          sell_proceeds + (net_tokens * payout_rate) - cost_basis as pnl,
          (sell_proceeds + (net_tokens * payout_rate) - cost_basis) / cost_basis * 100 as return_pct,
          if(sell_proceeds + (net_tokens * payout_rate) > cost_basis, 1, 0) as is_win,
          first_trade,
          last_trade
        FROM (
          SELECT
            t.wallet,
            tm.condition_id as cond_id,
            sum(if(t.side = 'BUY', t.tokens, -t.tokens)) as net_tokens,
            sum(if(t.side = 'BUY', t.usdc, 0)) as cost_basis,
            sum(if(t.side = 'SELL', t.usdc, 0)) as sell_proceeds,
            any(toFloat64(arrayElement(
              JSONExtract(r.payout_numerators, 'Array(UInt64)'),
              toUInt32(tm.outcome_index + 1)
            )) / toFloat64(r.payout_denominator)) as payout_rate,
            min(t.trade_time) as first_trade,
            max(t.trade_time) as last_trade
          FROM (
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
          ) t
          INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0
              AND payout_denominator != ''
              AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
          GROUP BY t.wallet, tm.condition_id
          HAVING cost_basis > 1 AND net_tokens >= 0
        )
      )
      GROUP BY wallet
    )
    WHERE
      wins / positions >= 0.85
      AND avg_win_pct >= 30
      AND positions >= 8
      AND days_active >= 14
      AND days_since_last <= 60
      AND positions / days_active < 2
    ORDER BY win_rate DESC, avg_win_pct DESC
    LIMIT 50
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length === 0) {
      console.log('No snipers found with strict criteria. Relaxing...\n');
      await findRelaxed();
      return;
    }

    printResults(data);
  } catch (err: any) {
    console.error('Query failed:', err.message);
    console.log('\nTrying alternative approach...');
    await findFromMetrics();
  }
}

async function findRelaxed() {
  const query = `
    SELECT
      wallet,
      round(wins / positions, 3) as win_rate,
      round(avg_win_pct, 1) as avg_win_pct,
      round(coalesce(avg_loss_pct, 0), 1) as avg_loss_pct,
      positions,
      wins,
      round(total_pnl, 2) as total_pnl,
      days_active,
      days_since_last
    FROM (
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        avgIf(return_pct, is_win = 1) as avg_win_pct,
        avgIf(abs(return_pct), is_win = 0) as avg_loss_pct,
        sum(pnl) as total_pnl,
        dateDiff('day', min(first_trade), max(last_trade)) + 1 as days_active,
        dateDiff('day', max(last_trade), now()) as days_since_last
      FROM (
        SELECT
          wallet,
          cond_id,
          cost_basis,
          sell_proceeds,
          net_tokens,
          payout_rate,
          sell_proceeds + (net_tokens * payout_rate) - cost_basis as pnl,
          (sell_proceeds + (net_tokens * payout_rate) - cost_basis) / cost_basis * 100 as return_pct,
          if(sell_proceeds + (net_tokens * payout_rate) > cost_basis, 1, 0) as is_win,
          first_trade,
          last_trade
        FROM (
          SELECT
            t.wallet,
            tm.condition_id as cond_id,
            sum(if(t.side = 'BUY', t.tokens, -t.tokens)) as net_tokens,
            sum(if(t.side = 'BUY', t.usdc, 0)) as cost_basis,
            sum(if(t.side = 'SELL', t.usdc, 0)) as sell_proceeds,
            any(toFloat64(arrayElement(
              JSONExtract(r.payout_numerators, 'Array(UInt64)'),
              toUInt32(tm.outcome_index + 1)
            )) / toFloat64(r.payout_denominator)) as payout_rate,
            min(t.trade_time) as first_trade,
            max(t.trade_time) as last_trade
          FROM (
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
          ) t
          INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0
              AND payout_denominator != ''
              AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
          GROUP BY t.wallet, tm.condition_id
          HAVING cost_basis > 1 AND net_tokens >= 0
        )
      )
      GROUP BY wallet
    )
    WHERE
      wins / positions >= 0.80  -- Relaxed to 80%
      AND avg_win_pct >= 20     -- Relaxed to 20%
      AND positions >= 8
      AND days_active >= 7      -- Relaxed to 1 week
    ORDER BY win_rate DESC, avg_win_pct DESC
    LIMIT 50
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  if (data.length === 0) {
    console.log('Still no results. The query may be timing out or data is sparse.');
    return;
  }

  console.log(`Found ${data.length} candidates with relaxed criteria (80%+ WR, 20%+ avg win):\n`);
  printResults(data);
}

async function findFromMetrics() {
  // Fall back to metrics table if raw query fails
  console.log('Checking pm_copy_trading_metrics_v1...\n');

  const query = `
    SELECT
      wallet_address as wallet,
      win_rate,
      avg_win_pct,
      avg_loss_pct,
      resolved_positions as positions,
      win_count as wins,
      realized_pnl as total_pnl,
      days_active
    FROM pm_copy_trading_metrics_v1 FINAL
    WHERE
      win_rate >= 0.85
      AND avg_win_pct >= 30
      AND resolved_positions >= 8
    ORDER BY win_rate DESC, avg_win_pct DESC
    LIMIT 50
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  if (data.length === 0) {
    console.log('No snipers in metrics table either.');
    return;
  }

  console.log(`Found ${data.length} candidates from metrics table:\n`);
  for (const r of data) {
    console.log(`${r.wallet} - WR: ${(r.win_rate * 100).toFixed(1)}%, AvgWin: ${r.avg_win_pct}%`);
  }
}

function printResults(data: any[]) {
  console.log(`Found ${data.length} SNIPER wallets:\n`);
  console.log('='.repeat(110));
  console.log(
    'Wallet'.padEnd(44) +
    'Win%'.padStart(8) +
    'AvgWin%'.padStart(10) +
    'AvgLoss%'.padStart(10) +
    'Trades'.padStart(8) +
    'PnL'.padStart(12) +
    'Days'.padStart(6) +
    'Last'.padStart(8)
  );
  console.log('='.repeat(110));

  for (const r of data) {
    console.log(
      r.wallet.padEnd(44) +
      `${(r.win_rate * 100).toFixed(1)}%`.padStart(8) +
      `${r.avg_win_pct}%`.padStart(10) +
      `${r.avg_loss_pct}%`.padStart(10) +
      String(r.positions).padStart(8) +
      `$${r.total_pnl}`.padStart(12) +
      String(r.days_active).padStart(6) +
      `${r.days_since_last}d`.padStart(8)
    );
  }

  console.log('\n=== TOP SNIPER CANDIDATES FOR $10-20 BETS ===\n');

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const r = data[i];
    const ev = (r.win_rate * r.avg_win_pct / 100) - ((1 - r.win_rate) * r.avg_loss_pct / 100);
    console.log(`${i + 1}. ${r.wallet}`);
    console.log(`   Win Rate:    ${(r.win_rate * 100).toFixed(1)}% (${r.wins}/${r.positions})`);
    console.log(`   Avg Win:     ${r.avg_win_pct}%`);
    console.log(`   Avg Loss:    ${r.avg_loss_pct}%`);
    console.log(`   Total PnL:   $${r.total_pnl}`);
    console.log(`   EV per $1:   $${ev.toFixed(3)}`);
    console.log(`   At $10 bet:  $${(ev * 10).toFixed(2)} expected per trade`);
    console.log(`   At $20 bet:  $${(ev * 20).toFixed(2)} expected per trade`);
    console.log(`   Polymarket:  https://polymarket.com/profile/${r.wallet}`);
    console.log('');
  }
}

main().catch(console.error);
