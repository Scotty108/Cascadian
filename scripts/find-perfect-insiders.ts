/**
 * Find PERFECT INSIDERS from ALL 1.8M wallets
 *
 * Criteria:
 * - 100% win rate (NEVER lost)
 * - Entry price < 85% (NOT arbers)
 * - Multiple positions (not just 1 lucky trade)
 * - Big % returns per trade
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 900000, // 15 minutes
  clickhouse_settings: {
    max_execution_time: 900,
    max_memory_usage: 20000000000, // 20GB
  },
});

async function main() {
  console.log('=== SEARCHING ALL 1.8M WALLETS FOR PERFECT INSIDERS ===');
  console.log('Looking for: 100% WR, NOT arbers, multiple trades, big % gains\n');
  console.log('This will take 5-10 minutes...\n');

  const startTime = Date.now();

  // Simplified query focusing on finding perfect records with good returns
  const query = `
    SELECT
      wallet,
      positions,
      wins,
      round(total_pnl, 2) as total_pnl,
      round(avg_entry * 100, 1) as avg_entry_pct,
      round(avg_return * 100, 1) as avg_return_pct,
      round(min_entry * 100, 1) as best_entry_pct,
      round(max_return * 100, 1) as best_return_pct,
      round(avg_bet, 2) as avg_bet
    FROM (
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        sum(pnl) as total_pnl,
        avg(entry_price) as avg_entry,
        avgIf(return_pct, is_win = 1) as avg_return,
        min(entry_price) as min_entry,
        maxIf(return_pct, is_win = 1) as max_return,
        avg(cost_basis) as avg_bet
      FROM (
        SELECT
          wallet,
          cond,
          cost_basis,
          entry_price,
          pnl,
          if(pnl > 0, 1, 0) as is_win,
          if(cost_basis > 0, pnl / cost_basis, 0) as return_pct
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
        WHERE entry_price > 0.01 AND entry_price < 0.85  -- NOT arbers, not dust
      )
      GROUP BY wallet
      HAVING
        positions >= 5              -- At least 5 trades
        AND wins = positions        -- 100% win rate (NEVER lost)
        AND total_pnl > 100         -- Made at least $100
    )
    WHERE avg_return > 0.20  -- At least 20% avg return per trade
    ORDER BY avg_return DESC, total_pnl DESC
    LIMIT 200
  `;

  try {
    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`Query completed in ${elapsed} minutes`);
    console.log(`\n🎯 Found ${data.length} PERFECT INSIDERS\n`);

    if (data.length === 0) {
      console.log('No perfect insiders found. Trying relaxed criteria...\n');
      await findRelaxed();
      return;
    }

    console.log('Wallet'.padEnd(44) + 'Pos'.padStart(5) + 'Entry'.padStart(8) + 'AvgRet'.padStart(9) + 'BestRet'.padStart(9) + 'PnL'.padStart(12));
    console.log('='.repeat(95));

    for (const r of data.slice(0, 50)) {
      console.log(
        r.wallet.padEnd(44) +
        String(r.positions).padStart(5) +
        `${r.avg_entry_pct}%`.padStart(8) +
        `${r.avg_return_pct}%`.padStart(9) +
        `${r.best_return_pct}%`.padStart(9) +
        `$${r.total_pnl}`.padStart(12)
      );
    }

    // Top performers with huge returns
    const mega = data.filter((r: any) => r.avg_return_pct >= 100);
    console.log(`\n\n🔥 MEGA RETURNS (100%+ avg return per trade): ${mega.length} wallets\n`);

    for (const r of mega.slice(0, 20)) {
      console.log(`${r.wallet}`);
      console.log(`  Perfect Record: ${r.wins}/${r.positions} wins (100%)`);
      console.log(`  Avg Entry:      ${r.avg_entry_pct}% (NOT an arber)`);
      console.log(`  Avg Return:     ${r.avg_return_pct}% per trade 🚀`);
      console.log(`  Best Trade:     ${r.best_return_pct}% return`);
      console.log(`  Total PnL:      $${r.total_pnl}`);
      console.log(`  Avg Bet:        $${r.avg_bet}`);
      console.log(`  Profile:        https://polymarket.com/profile/${r.wallet}`);
      console.log('');
    }

    // Early entry specialists
    const earlyEntry = data.filter((r: any) => r.avg_entry_pct <= 30);
    console.log(`\n🎯 EARLIEST CALLERS (avg entry <= 30%): ${earlyEntry.length} wallets\n`);

    for (const r of earlyEntry.slice(0, 15)) {
      console.log(`${r.wallet}`);
      console.log(`  Avg Entry:  ${r.avg_entry_pct}% (called it VERY early)`);
      console.log(`  Best Entry: ${r.best_entry_pct}%`);
      console.log(`  Avg Return: ${r.avg_return_pct}%`);
      console.log(`  PnL: $${r.total_pnl}`);
      console.log('');
    }

    console.log('\n=== ALL PERFECT INSIDER ADDRESSES ===\n');
    for (const r of data) {
      console.log(r.wallet);
    }

  } catch (err: any) {
    console.error('Query failed:', err.message);
    if (err.message.includes('Timeout')) {
      console.log('\nQuery timed out. Database may be under load.');
    }
    if (err.message.includes('disk') || err.message.includes('space') || err.message.includes('evict')) {
      console.log('\nDatabase ran out of temp disk space. Trying smaller query...');
      await findRelaxed();
    }
  } finally {
    await client.close();
  }
}

async function findRelaxed() {
  console.log('Trying with stricter position count to reduce memory...\n');

  const query = `
    SELECT
      wallet,
      positions,
      wins,
      round(total_pnl, 2) as total_pnl,
      round(avg_entry * 100, 1) as avg_entry_pct,
      round(avg_return * 100, 1) as avg_return_pct,
      round(avg_bet, 2) as avg_bet
    FROM (
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        sum(pnl) as total_pnl,
        avg(entry_price) as avg_entry,
        avgIf(return_pct, is_win = 1) as avg_return,
        avg(cost_basis) as avg_bet
      FROM (
        SELECT
          wallet,
          cond,
          cost_basis,
          entry_price,
          pnl,
          if(pnl > 0, 1, 0) as is_win,
          if(cost_basis > 0, pnl / cost_basis, 0) as return_pct
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
          HAVING cost_basis > 10 AND sum(if(e.side = 'buy', e.tokens, -e.tokens)) >= 0
        )
        WHERE entry_price > 0.05 AND entry_price < 0.80
      )
      GROUP BY wallet
      HAVING
        positions >= 3
        AND wins = positions
        AND total_pnl > 50
    )
    WHERE avg_return > 0.50
    ORDER BY avg_return DESC
    LIMIT 100
  `;

  try {
    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    console.log(`Found ${data.length} perfect insiders (relaxed criteria)\n`);

    for (const r of data.slice(0, 30)) {
      console.log(`${r.wallet} - ${r.positions} wins, ${r.avg_entry_pct}% entry, ${r.avg_return_pct}% return, $${r.total_pnl}`);
    }
  } catch (err: any) {
    console.error('Relaxed query also failed:', err.message);
  }
}

main().catch(console.error);
