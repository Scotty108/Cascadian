/**
 * Find wallets that consistently enter positions early and win
 *
 * "Early" = buying at <50% odds
 * "Win" = position resolved in their favor with profit
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
  clickhouse_settings: {
    max_execution_time: 300,
  },
});

async function main() {
  console.log('=== FINDING EARLY CALLERS / INSIDERS ===');
  console.log('Looking for wallets that buy early (<50%) and win consistently\n');

  // This query finds wallets where:
  // 1. They bought at low odds (<50%)
  // 2. The position resolved with the token paying out (payout = 1.0)
  // 3. They did this multiple times with high success
  const query = `
    SELECT
      wallet,
      count() as positions,
      sum(is_early_win) as early_wins,
      sum(is_win) as total_wins,
      sum(is_win) / count() as win_rate,
      avgIf(entry_price, is_win = 1) as avg_win_entry,
      avgIf(1.0 - entry_price, is_win = 1) as avg_price_swing,
      minIf(entry_price, is_win = 1 AND is_early_win = 1) as best_early_call,
      sum(pnl) as total_pnl,
      avg(cost_basis) as avg_bet
    FROM (
      SELECT
        wallet,
        cond,
        cost_basis,
        entry_price,
        payout_rate,
        pnl,
        if(pnl > 0, 1, 0) as is_win,
        if(pnl > 0 AND entry_price < 0.50, 1, 0) as is_early_win
      FROM (
        SELECT
          e.wallet as wallet,
          e.cond as cond,
          sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
          sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
          sum(if(e.side = 'sell', e.usdc, 0)) as sell_proceeds,
          sum(if(e.side = 'buy', e.tokens, -e.tokens)) as net_tokens,
          any(e.payout) as payout_rate,
          sum(if(e.side = 'sell', e.usdc, 0)) +
            (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
            sum(if(e.side = 'buy', e.usdc, 0)) as pnl
        FROM (
          SELECT
            t.wallet as wallet,
            tm.condition_id as cond,
            t.side as side,
            t.usdc as usdc,
            t.tokens as tokens,
            toFloat64(arrayElement(
              JSONExtract(r.payout_numerators, 'Array(UInt64)'),
              toUInt32(tm.outcome_index + 1)
            )) / toFloat64(r.payout_denominator) as payout
          FROM (
            SELECT
              event_id,
              any(trader_wallet) as wallet,
              any(token_id) as token_id,
              any(lower(side)) as side,
              any(usdc_amount) / 1e6 as usdc,
              any(token_amount) / 1e6 as tokens
            FROM pm_trader_events_v2
            WHERE is_deleted = 0
            GROUP BY event_id
          ) t
          INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
        ) e
        GROUP BY e.wallet, e.cond
        HAVING cost_basis > 5 AND net_tokens >= 0
      )
      WHERE entry_price > 0 AND entry_price < 1
    )
    GROUP BY wallet
    HAVING
      positions >= 5
      AND sum(is_early_win) >= 3  -- At least 3 early wins
      AND sum(is_win) / count() >= 0.70  -- 70%+ win rate
      AND sum(pnl) > 0  -- Positive PnL
      AND avg(cost_basis) >= 10  -- Avg bet >= $10
    ORDER BY early_wins DESC, avg_price_swing DESC
    LIMIT 100
  `;

  console.log('Running query (this may take 2-3 minutes)...\n');

  try {
    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    console.log(`Found ${data.length} wallets with insider-like patterns\n`);

    if (data.length === 0) {
      console.log('No wallets found. Trying with relaxed criteria...');
      await findRelaxed();
      return;
    }

    console.log('Wallet'.padEnd(44) + 'WR%'.padStart(6) + 'Early'.padStart(7) + 'Swing'.padStart(8) + 'Best'.padStart(7) + 'PnL'.padStart(12));
    console.log('='.repeat(90));

    for (const r of data.slice(0, 50)) {
      console.log(
        r.wallet.padEnd(44) +
        `${(r.win_rate * 100).toFixed(0)}%`.padStart(6) +
        String(r.early_wins).padStart(7) +
        `${(r.avg_price_swing * 100).toFixed(0)}%`.padStart(8) +
        `${(r.best_early_call * 100).toFixed(0)}%`.padStart(7) +
        `$${r.total_pnl.toFixed(0)}`.padStart(12)
      );
    }

    // Top early callers
    console.log('\n\n🎯 TOP 20 EARLY CALLERS / LIKELY INSIDERS:\n');

    for (const r of data.slice(0, 20)) {
      console.log(r.wallet);
      console.log(`  Win Rate:      ${(r.win_rate * 100).toFixed(1)}% (${r.total_wins}/${r.positions})`);
      console.log(`  Early Wins:    ${r.early_wins} (bought < 50% odds and won)`);
      console.log(`  Avg Entry:     ${(r.avg_win_entry * 100).toFixed(1)}% (on wins)`);
      console.log(`  Price Swing:   ${(r.avg_price_swing * 100).toFixed(1)}% captured`);
      console.log(`  Best Call:     Entered at ${(r.best_early_call * 100).toFixed(1)}% and won`);
      console.log(`  Total PnL:     $${r.total_pnl.toFixed(2)}`);
      console.log(`  Avg Bet:       $${r.avg_bet.toFixed(2)}`);
      console.log(`  Profile:       https://polymarket.com/profile/${r.wallet}`);
      console.log('');
    }

    // Filter for most suspicious
    const suspicious = data.filter((r: any) =>
      r.avg_price_swing >= 0.40 &&  // 40%+ swing
      r.early_wins >= 5 &&          // 5+ early wins
      r.win_rate >= 0.80            // 80%+ WR
    );

    console.log(`\n🔥 MOST SUSPICIOUS (40%+ swing, 5+ early wins, 80%+ WR): ${suspicious.length}\n`);

    for (const r of suspicious) {
      console.log(`${r.wallet}`);
      console.log(`  → ${r.early_wins} early wins at avg ${(r.avg_win_entry * 100).toFixed(0)}% entry`);
      console.log(`  → Captured ${(r.avg_price_swing * 100).toFixed(0)}% avg price movement`);
      console.log(`  → Best call: ${(r.best_early_call * 100).toFixed(0)}% entry`);
      console.log(`  → Total PnL: $${r.total_pnl.toFixed(0)}`);
      console.log('');
    }

    console.log('\n=== ALL EARLY CALLER ADDRESSES ===\n');
    for (const r of data) {
      console.log(r.wallet);
    }

  } catch (err: any) {
    console.error('Query failed:', err.message);
    if (err.message.includes('Timeout')) {
      console.log('\nQuery timed out. The database may be under load.');
    }
  } finally {
    await client.close();
  }
}

async function findRelaxed() {
  console.log('\nTrying with relaxed criteria (2+ early wins, 60%+ WR)...\n');

  const query = `
    SELECT
      wallet,
      count() as positions,
      sum(is_early_win) as early_wins,
      sum(is_win) as total_wins,
      sum(is_win) / count() as win_rate,
      avgIf(entry_price, is_win = 1) as avg_win_entry,
      avgIf(1.0 - entry_price, is_win = 1) as avg_price_swing,
      minIf(entry_price, is_win = 1 AND is_early_win = 1) as best_early_call,
      sum(pnl) as total_pnl,
      avg(cost_basis) as avg_bet
    FROM (
      SELECT
        wallet,
        cond,
        cost_basis,
        entry_price,
        pnl,
        if(pnl > 0, 1, 0) as is_win,
        if(pnl > 0 AND entry_price < 0.50, 1, 0) as is_early_win
      FROM (
        SELECT
          e.wallet as wallet,
          e.cond as cond,
          sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
          sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
          sum(if(e.side = 'sell', e.usdc, 0)) +
            (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
            sum(if(e.side = 'buy', e.usdc, 0)) as pnl
        FROM (
          SELECT
            t.wallet as wallet,
            tm.condition_id as cond,
            t.side as side,
            t.usdc as usdc,
            t.tokens as tokens,
            toFloat64(arrayElement(
              JSONExtract(r.payout_numerators, 'Array(UInt64)'),
              toUInt32(tm.outcome_index + 1)
            )) / toFloat64(r.payout_denominator) as payout
          FROM (
            SELECT
              event_id,
              any(trader_wallet) as wallet,
              any(token_id) as token_id,
              any(lower(side)) as side,
              any(usdc_amount) / 1e6 as usdc,
              any(token_amount) / 1e6 as tokens
            FROM pm_trader_events_v2
            WHERE is_deleted = 0
            GROUP BY event_id
          ) t
          INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
        ) e
        GROUP BY e.wallet, e.cond
        HAVING cost_basis > 5 AND sum(if(e.side = 'buy', e.tokens, -e.tokens)) >= 0
      )
      WHERE entry_price > 0 AND entry_price < 1
    )
    GROUP BY wallet
    HAVING
      positions >= 5
      AND sum(is_early_win) >= 2  -- Relaxed: 2+ early wins
      AND sum(is_win) / count() >= 0.60  -- Relaxed: 60%+ win rate
      AND sum(pnl) > 0
    ORDER BY early_wins DESC, avg_price_swing DESC
    LIMIT 50
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  console.log(`Found ${data.length} wallets with relaxed criteria\n`);

  for (const r of data.slice(0, 20)) {
    console.log(`${r.wallet} - EarlyWins:${r.early_wins} WR:${(r.win_rate*100).toFixed(0)}% Swing:${(r.avg_price_swing*100).toFixed(0)}% PnL:$${r.total_pnl.toFixed(0)}`);
  }
}

main().catch(console.error);
