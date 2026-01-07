/**
 * Find TRUE INSIDERS in Fed/Tech/Econ markets - V2
 * Uses subquery approach to avoid query size limits
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== FINDING FED/TECH/ECON INSIDERS ===');
  console.log('Searching for perfect records in insider-knowledge markets\n');

  // Direct query with subquery for market filtering
  const query = `
    SELECT
      wallet,
      count() as positions,
      sum(is_win) as wins,
      groupArray(question)[1] as sample_market,
      avg(entry_price) as avg_entry,
      avg(return_pct) as avg_return,
      max(return_pct) as best_return,
      sum(pnl) as total_pnl,
      avg(cost_basis) as avg_bet
    FROM (
      SELECT
        wallet,
        cond,
        question,
        cost_basis,
        entry_price,
        pnl,
        if(pnl > 0, 1, 0) as is_win,
        pnl / nullIf(cost_basis, 0) as return_pct
      FROM (
        SELECT
          e.wallet as wallet,
          e.cond as cond,
          any(e.question) as question,
          sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
          sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
          sum(if(e.side = 'sell', e.usdc, 0)) +
            (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
            sum(if(e.side = 'buy', e.usdc, 0)) as pnl
        FROM (
          SELECT
            t.wallet as wallet,
            tm.condition_id as cond,
            tm.question as question,
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
          INNER JOIN (
            SELECT token_id_dec, condition_id, outcome_index, question
            FROM pm_token_to_condition_map_v5
            WHERE
              lower(question) LIKE '%fed %'
              OR lower(question) LIKE '%federal reserve%'
              OR lower(question) LIKE '%interest rate%'
              OR lower(question) LIKE '%fomc%'
              OR lower(question) LIKE '%rate cut%'
              OR lower(question) LIKE '%rate hike%'
              OR lower(question) LIKE '% bps%'
              OR lower(question) LIKE '%earnings%'
              OR lower(question) LIKE '%tesla%'
              OR lower(question) LIKE '%nvidia%'
              OR lower(question) LIKE '%apple%'
              OR lower(question) LIKE '%aapl%'
              OR lower(question) LIKE '%google%'
              OR lower(question) LIKE '%microsoft%'
              OR lower(question) LIKE '%amazon%'
              OR lower(question) LIKE '%meta %'
              OR lower(question) LIKE '%gdp%'
              OR lower(question) LIKE '%inflation%'
              OR lower(question) LIKE '%cpi %'
              OR lower(question) LIKE '%jobs report%'
              OR lower(question) LIKE '%unemployment%'
              OR lower(question) LIKE '%nonfarm%'
              OR lower(question) LIKE '%bitcoin%'
              OR lower(question) LIKE '%btc %'
              OR lower(question) LIKE '%ethereum%'
          ) tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
        ) e
        GROUP BY e.wallet, e.cond
        HAVING cost_basis > 10
      )
      WHERE entry_price > 0.05 AND entry_price < 0.80
    )
    GROUP BY wallet
    HAVING
      count() >= 3
      AND sum(is_win) = count()  -- 100% win rate
      AND sum(pnl) > 100
    ORDER BY count() DESC, sum(pnl) DESC
    LIMIT 100
  `;

  console.log('Running query (may take 2-5 minutes)...\n');

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const wallets = await result.json() as any[];

    console.log(`\n🎯 Found ${wallets.length} wallets with PERFECT records in Fed/Tech/Econ\n`);

    if (wallets.length === 0) {
      console.log('No perfect records found in these markets.');
      console.log('Trying with relaxed criteria (2+ positions)...\n');
      await findRelaxed();
      return;
    }

    console.log('Wallet'.padEnd(44) + 'Wins'.padStart(6) + 'Entry'.padStart(8) + 'Return'.padStart(9) + 'PnL'.padStart(12));
    console.log('='.repeat(85));

    for (const w of wallets.slice(0, 30)) {
      console.log(
        w.wallet.padEnd(44) +
        String(w.positions).padStart(6) +
        `${(w.avg_entry * 100).toFixed(0)}%`.padStart(8) +
        `${(w.avg_return * 100).toFixed(0)}%`.padStart(9) +
        `$${w.total_pnl.toFixed(0)}`.padStart(12)
      );
    }

    console.log('\n\n🔥 TOP FED/TECH INSIDERS:\n');

    for (const w of wallets.slice(0, 20)) {
      console.log(w.wallet);
      console.log(`  Perfect Record: ${w.wins}/${w.positions} (100% WR in Fed/Tech/Econ)`);
      console.log(`  Avg Entry:      ${(w.avg_entry * 100).toFixed(1)}%`);
      console.log(`  Avg Return:     ${(w.avg_return * 100).toFixed(0)}% per trade`);
      console.log(`  Best Return:    ${(w.best_return * 100).toFixed(0)}%`);
      console.log(`  Total PnL:      $${w.total_pnl.toFixed(2)}`);
      console.log(`  Avg Bet:        $${w.avg_bet.toFixed(2)}`);
      console.log(`  Sample Market:  ${w.sample_market?.substring(0, 70)}...`);
      console.log(`  Profile:        https://polymarket.com/profile/${w.wallet}`);
      console.log('');
    }

    // Early callers with big returns
    const impressive = wallets.filter((w: any) =>
      w.avg_entry < 0.50 &&
      w.avg_return >= 0.50
    );

    console.log(`\n🎯 MOST SUSPICIOUS (entry < 50%, return >= 50%): ${impressive.length}\n`);

    for (const w of impressive) {
      console.log(`${w.wallet}`);
      console.log(`  → ${w.wins} perfect calls at avg ${(w.avg_entry * 100).toFixed(0)}% entry`);
      console.log(`  → ${(w.avg_return * 100).toFixed(0)}% avg return, $${w.total_pnl.toFixed(0)} PnL`);
      console.log(`  → ${w.sample_market?.substring(0, 60)}...`);
    }

    console.log('\n=== ALL FED/TECH INSIDER ADDRESSES ===\n');
    for (const w of wallets) {
      console.log(w.wallet);
    }

  } catch (err: any) {
    console.error('Query failed:', err.message);
    if (err.message.includes('disk') || err.message.includes('evict')) {
      console.log('\nDatabase out of temp space. Try again later.');
    }
  }
}

async function findRelaxed() {
  const query = `
    SELECT
      wallet,
      count() as positions,
      sum(is_win) as wins,
      groupArray(question)[1] as sample_market,
      avg(entry_price) as avg_entry,
      avg(return_pct) as avg_return,
      sum(pnl) as total_pnl
    FROM (
      SELECT
        wallet,
        cond,
        question,
        cost_basis,
        entry_price,
        pnl,
        if(pnl > 0, 1, 0) as is_win,
        pnl / nullIf(cost_basis, 0) as return_pct
      FROM (
        SELECT
          e.wallet as wallet,
          e.cond as cond,
          any(e.question) as question,
          sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
          sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
          sum(if(e.side = 'sell', e.usdc, 0)) +
            (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
            sum(if(e.side = 'buy', e.usdc, 0)) as pnl
        FROM (
          SELECT
            t.wallet as wallet,
            tm.condition_id as cond,
            tm.question as question,
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
          INNER JOIN (
            SELECT token_id_dec, condition_id, outcome_index, question
            FROM pm_token_to_condition_map_v5
            WHERE
              lower(question) LIKE '%fed %'
              OR lower(question) LIKE '%interest rate%'
              OR lower(question) LIKE '%fomc%'
              OR lower(question) LIKE '%earnings%'
              OR lower(question) LIKE '%tesla%'
              OR lower(question) LIKE '%nvidia%'
              OR lower(question) LIKE '%apple%'
              OR lower(question) LIKE '%inflation%'
              OR lower(question) LIKE '%cpi %'
              OR lower(question) LIKE '%gdp%'
          ) tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
        ) e
        GROUP BY e.wallet, e.cond
        HAVING cost_basis > 10
      )
      WHERE entry_price > 0.05 AND entry_price < 0.70
    )
    GROUP BY wallet
    HAVING
      count() >= 2
      AND sum(is_win) = count()
      AND sum(pnl) > 50
    ORDER BY avg_return DESC
    LIMIT 50
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as any[];

  console.log(`Found ${wallets.length} wallets with relaxed criteria\n`);

  for (const w of wallets) {
    console.log(`${w.wallet} - ${w.wins} wins, ${(w.avg_entry*100).toFixed(0)}% entry, ${(w.avg_return*100).toFixed(0)}% return`);
    console.log(`  ${w.sample_market?.substring(0, 60)}...`);
  }
}

main().catch(console.error);
