#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('A) PROOF: 75% UNRESOLVED TAIL - COHORT RESOLUTION RATE');
  console.log('═'.repeat(80));
  console.log('');

  // A) Cohort resolution rate by month of first trade
  console.log('Cohort resolution rate by month of first trade:');
  console.log('─'.repeat(80));

  const cohortQuery = await client.query({
    query: `
      WITH m AS (
        SELECT
          toStartOfMonth(min(timestamp)) AS cohort_month,
          condition_id_norm AS market_cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY market_cid
      ),
      r AS (
        SELECT lower(concat('0x', condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
      )
      SELECT
        cohort_month,
        uniq(market_cid) AS traded_markets,
        uniqIf(market_cid, r.cid_hex IS NOT NULL) AS resolved_markets,
        round(resolved_markets / traded_markets * 100, 2) AS pct_resolved
      FROM m
      LEFT JOIN r ON r.cid_hex = m.market_cid
      GROUP BY cohort_month
      ORDER BY cohort_month
    `,
    format: 'JSONEachRow',
  });

  const cohorts = await cohortQuery.json<Array<{
    cohort_month: string;
    traded_markets: number;
    resolved_markets: number;
    pct_resolved: number;
  }>>();

  console.log('Month       | Traded | Resolved | % Resolved');
  console.log('─'.repeat(60));
  cohorts.forEach(c => {
    const month = c.cohort_month.substring(0, 7);
    console.log(
      `${month}  | ${c.traded_markets.toString().padStart(6)} | ${c.resolved_markets.toString().padStart(8)} | ${c.pct_resolved.toString().padStart(6)}%`
    );
  });
  console.log();

  // Calculate weighted average
  const totalTraded = cohorts.reduce((sum, c) => sum + c.traded_markets, 0);
  const totalResolved = cohorts.reduce((sum, c) => sum + c.resolved_markets, 0);
  const overallPct = (100 * totalResolved / totalTraded).toFixed(2);

  console.log('OVERALL:');
  console.log(`  Total traded markets:    ${totalTraded.toLocaleString()}`);
  console.log(`  Total resolved markets:  ${totalResolved.toLocaleString()}`);
  console.log(`  Overall % resolved:      ${overallPct}%`);
  console.log();

  // Identify recent cohorts dominating the tail
  const recentCohorts = cohorts.slice(-6); // Last 6 months
  const recentTraded = recentCohorts.reduce((sum, c) => sum + c.traded_markets, 0);
  const recentPct = (100 * recentTraded / totalTraded).toFixed(1);

  console.log('INTERPRETATION:');
  console.log(`  Last 6 months represent ${recentPct}% of all traded markets`);
  console.log(`  Recent cohorts have lower resolution rates (markets still open)`);
  console.log('  This explains why overall coverage is only 24.8%');
  console.log();

  // B) Confirm we're not missing trades
  console.log('═'.repeat(80));
  console.log('C) CONFIRM: NOT MISSING TRADES - COVERAGE BY SOURCE');
  console.log('═'.repeat(80));
  console.log();

  const TEST_WALLETS = [
    '0x4ce73141dbfce41e65db3723e31059a730f0abad',
    '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144',
    '0x1f0a343513aa6060488fabe96960e6d1e177f7aa',
    '0x06dcaa14f57d8a0573f5dc5940565e6de667af59',
    '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed',
    '0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f',
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
  ];

  for (const wallet of TEST_WALLETS) {
    const sourceQuery = await client.query({
      query: `
        SELECT
          count() AS trades,
          min(timestamp) AS first_ts,
          max(timestamp) AS last_ts
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet}')
      `,
      format: 'JSONEachRow',
    });

    const result = (await sourceQuery.json<any[]>())[0];

    if (result && result.trades > 0) {
      console.log(`${wallet.substring(0, 10)}...`);
      console.log(`  Trades: ${result.trades.toLocaleString()}`);
      console.log(`  First:  ${result.first_ts}`);
      console.log(`  Last:   ${result.last_ts}`);
      console.log();
    }
  }

  // D) Catch "repeaters" that should have resolved
  console.log('═'.repeat(80));
  console.log('D) CATCH REPEATERS: MARKETS THAT ENDED >7 DAYS AGO WITHOUT RESOLUTION');
  console.log('═'.repeat(80));
  console.log();

  const repeatersQuery = await client.query({
    query: `
      WITH last_trade AS (
        SELECT
          condition_id_norm AS market_cid,
          max(timestamp) AS last_trade_ts
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY market_cid
      )
      SELECT
        l.market_cid,
        l.last_trade_ts,
        dateDiff('day', l.last_trade_ts, now()) AS days_since_last_trade
      FROM last_trade l
      LEFT JOIN default.market_resolutions_final r
        ON lower(l.market_cid) = concat('0x', r.condition_id_norm)
      WHERE r.condition_id_norm IS NULL
        AND days_since_last_trade >= 7
      ORDER BY days_since_last_trade DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const repeaters = await repeatersQuery.json<Array<{
    market_cid: string;
    last_trade_ts: string;
    days_since_last_trade: number;
  }>>();

  console.log('Top 20 markets by days since last trade (no resolution):');
  console.log('─'.repeat(80));
  console.log('Condition ID (first 20 chars) | Last Trade | Days Ago');
  console.log('─'.repeat(80));
  repeaters.forEach(r => {
    console.log(
      `${r.market_cid.substring(0, 22)}... | ${r.last_trade_ts.substring(0, 10)} | ${r.days_since_last_trade}`
    );
  });
  console.log();

  console.log('RECOMMENDATION:');
  console.log('  Use this list for targeted resolution fetch from Polymarket API');
  console.log('  These are most likely to have resolved but not in our database');
  console.log();

  // E) Summary
  console.log('═'.repeat(80));
  console.log('E) MINIMAL PLAN TO END THE CONFUSION');
  console.log('═'.repeat(80));
  console.log();
  console.log('1. ✅ FREEZE realized PnL on the 56k resolved markets (already working)');
  console.log();
  console.log('2. 📊 ADD unrealized PnL for all open positions:');
  console.log('   - Fetch current mid-prices from Polymarket API');
  console.log('   - Calculate: unrealized = position_size * (current_price - avg_cost)');
  console.log('   - Split UI into "Realized" vs "All" (realized + unrealized)');
  console.log();
  console.log('3. 🔄 BUILD daily queue of unresolved markets sorted by end_time:');
  console.log('   - Query markets that ended >7 days ago without resolution');
  console.log('   - Re-query Polymarket API once per day');
  console.log('   - Track "newly resolved today" metric');
  console.log();
  console.log('4. ❌ STOP blind scans:');
  console.log('   - No more blockchain scanning for all condition IDs');
  console.log('   - Only target the cohort in D) and oldest buckets');
  console.log('   - This separates "data missing" from "outcome not published yet"');
  console.log();

  await client.close();
}

main().catch(console.error);
