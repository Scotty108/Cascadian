/**
 * Find TRUE Superforecasters from FULL 800k database
 * V2: Using nested subqueries to avoid CTE scoping issues
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes
  clickhouse_settings: {
    max_execution_time: 600,
  },
});

async function main() {
  console.log('=== FULL DATABASE SUPERFORECASTER SEARCH ===');
  console.log('Searching 800k+ wallets. This will take 5-10 minutes...\n');

  const startTime = Date.now();

  // Simplified query using nested subqueries
  const query = `
    SELECT
      wallet,
      round(wins / positions, 3) as win_rate,
      round(avg_win_pct, 1) as avg_win_pct,
      round(coalesce(avg_loss_pct, 0), 1) as avg_loss_pct,
      positions,
      wins,
      round(total_pnl, 2) as total_pnl,
      round(arb_volume / nullIf(total_volume, 0) * 100, 1) as arb_pct
    FROM (
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        avgIf(return_pct, is_win = 1) as avg_win_pct,
        avgIf(abs(return_pct), is_win = 0) as avg_loss_pct,
        sum(pnl) as total_pnl,
        sum(buy_vol) as total_volume,
        sum(arb_vol) as arb_volume
      FROM (
        SELECT
          wallet,
          cond,
          cost - proceeds as invested,
          proceeds + (net_tok * payout) - cost as pnl,
          if(proceeds + (net_tok * payout) > cost, 1, 0) as is_win,
          (proceeds + (net_tok * payout) - cost) / nullIf(cost, 0) * 100 as return_pct,
          buy_vol,
          arb_vol
        FROM (
          SELECT
            e.wallet as wallet,
            e.cond as cond,
            sum(if(e.side = 'buy', e.usdc, 0)) as cost,
            sum(if(e.side = 'sell', e.usdc, 0)) as proceeds,
            sum(if(e.side = 'buy', e.tokens, -e.tokens)) as net_tok,
            any(e.payout) as payout,
            sum(if(e.side = 'buy', e.usdc, 0)) as buy_vol,
            sum(if(e.side = 'buy' AND e.usdc / nullIf(e.tokens, 0) >= 0.90, e.usdc, 0)) as arb_vol
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
          HAVING cost > 1 AND net_tok >= 0
        )
      )
      GROUP BY wallet
      HAVING positions >= 8
    )
    WHERE
      wins / positions >= 0.90
      AND total_pnl > 0
      AND arb_volume / nullIf(total_volume, 0) < 0.50
    ORDER BY wins / positions DESC, total_pnl DESC
    LIMIT 100
  `;

  console.log('Running query...');

  try {
    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nQuery completed in ${elapsed}s`);
    console.log(`Found ${data.length} TRUE SUPERFORECASTERS\n`);

    if (data.length === 0) {
      console.log('No superforecasters found with strict criteria (90%+ WR, <50% arb, positive PnL)');
      return;
    }

    console.log('='.repeat(100));
    console.log('Wallet'.padEnd(44) + 'WR%'.padStart(7) + 'AvgWin'.padStart(9) + 'Arb%'.padStart(7) + 'Pos'.padStart(6) + 'PnL'.padStart(12));
    console.log('='.repeat(100));

    for (const r of data) {
      console.log(
        r.wallet.padEnd(44) +
        `${(r.win_rate * 100).toFixed(1)}%`.padStart(7) +
        `${r.avg_win_pct}%`.padStart(9) +
        `${r.arb_pct}%`.padStart(7) +
        String(r.positions).padStart(6) +
        `$${r.total_pnl}`.padStart(12)
      );
    }

    // Filter for the BEST ones (high avg win too)
    const elite = data.filter((r: any) => r.avg_win_pct >= 10);

    console.log(`\n=== ELITE (90%+ WR, <50% arb, 10%+ avg win): ${elite.length} wallets ===\n`);
    for (const r of elite) {
      console.log(`${r.wallet}`);
      console.log(`  WR: ${(r.win_rate * 100).toFixed(1)}% | Avg Win: ${r.avg_win_pct}% | Arb: ${r.arb_pct}% | PnL: $${r.total_pnl}`);
    }

    console.log('\n=== ALL SUPERFORECASTER ADDRESSES ===\n');
    for (const r of data) {
      console.log(r.wallet);
    }

  } catch (err: any) {
    console.error('Query failed:', err.message);
    if (err.message.includes('Timeout')) {
      console.log('\nQuery timed out after 10 minutes.');
    }
  } finally {
    await client.close();
  }
}

main().catch(console.error);
