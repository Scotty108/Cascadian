/**
 * CCR-v1 Leaderboard: Filter Funnel Breakdown
 *
 * Shows how each filter reduces the wallet pool from total → final
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function filterFunnel() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Filter Funnel Breakdown');
  console.log('='.repeat(70));
  console.log('');

  const queries = [
    {
      name: '1. Total unique wallets (all CLOB trades ever)',
      query: `SELECT countDistinct(lower(trader_wallet)) as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0`
    },
    {
      name: '2. Active in last 30 days',
      query: `SELECT countDistinct(lower(trader_wallet)) as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY`
    },
    {
      name: '3. + ≥1 trade (sanity check)',
      query: `
        SELECT count(*) as cnt FROM (
          SELECT lower(trader_wallet) as w
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
          GROUP BY lower(trader_wallet)
          HAVING count(*) >= 1
        )
      `
    },
    {
      name: '4. + ≥$200 lifetime volume',
      query: `
        WITH active AS (
          SELECT DISTINCT lower(trader_wallet) as wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
        )
        SELECT count(*) as cnt FROM (
          SELECT lower(trader_wallet) as w, sum(usdc_amount)/1e6 as vol
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active)
          GROUP BY lower(trader_wallet)
          HAVING vol >= 200
        )
      `
    },
    {
      name: '5. + ≥20 distinct markets',
      query: `
        WITH active AS (
          SELECT DISTINCT lower(trader_wallet) as wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
        ),
        with_volume AS (
          SELECT lower(trader_wallet) as wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active)
          GROUP BY lower(trader_wallet)
          HAVING sum(usdc_amount)/1e6 >= 200
        )
        SELECT count(*) as cnt FROM (
          SELECT lower(t.trader_wallet) as w, countDistinct(m.condition_id) as markets
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE t.is_deleted = 0 AND lower(t.trader_wallet) IN (SELECT wallet FROM with_volume)
          GROUP BY lower(t.trader_wallet)
          HAVING markets >= 20
        )
      `
    },
    {
      name: '6. + ≥30 total trades',
      query: `
        WITH active AS (
          SELECT DISTINCT lower(trader_wallet) as wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
        ),
        with_volume AS (
          SELECT lower(trader_wallet) as wallet, count(*) as trades
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active)
          GROUP BY lower(trader_wallet)
          HAVING sum(usdc_amount)/1e6 >= 200 AND trades >= 30
        ),
        with_markets AS (
          SELECT lower(t.trader_wallet) as wallet
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE t.is_deleted = 0 AND lower(t.trader_wallet) IN (SELECT wallet FROM with_volume)
          GROUP BY lower(t.trader_wallet)
          HAVING countDistinct(m.condition_id) >= 20
        )
        SELECT count(*) as cnt FROM with_markets
      `
    },
    {
      name: '7. + ≤50 trades/day (human speed)',
      query: `
        WITH active AS (
          SELECT DISTINCT lower(trader_wallet) as wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
        ),
        wallet_stats AS (
          SELECT
            lower(trader_wallet) as wallet,
            count(*) as trades,
            sum(usdc_amount)/1e6 as volume,
            dateDiff('day', min(trade_time), max(trade_time)) + 1 as days
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active)
          GROUP BY lower(trader_wallet)
          HAVING volume >= 200 AND trades >= 30
        ),
        with_markets AS (
          SELECT lower(t.trader_wallet) as wallet
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE t.is_deleted = 0 AND lower(t.trader_wallet) IN (SELECT wallet FROM wallet_stats)
          GROUP BY lower(t.trader_wallet)
          HAVING countDistinct(m.condition_id) >= 20
        )
        SELECT count(*) as cnt FROM wallet_stats ws
        WHERE ws.wallet IN (SELECT wallet FROM with_markets)
          AND (ws.trades / ws.days) <= 50
      `
    },
    {
      name: '8. + ≥$50 avg trade size',
      query: `
        WITH active AS (
          SELECT DISTINCT lower(trader_wallet) as wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
        ),
        wallet_stats AS (
          SELECT
            lower(trader_wallet) as wallet,
            count(*) as trades,
            sum(usdc_amount)/1e6 as volume,
            dateDiff('day', min(trade_time), max(trade_time)) + 1 as days
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active)
          GROUP BY lower(trader_wallet)
          HAVING volume >= 200 AND trades >= 30
        ),
        with_markets AS (
          SELECT lower(t.trader_wallet) as wallet
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE t.is_deleted = 0 AND lower(t.trader_wallet) IN (SELECT wallet FROM wallet_stats)
          GROUP BY lower(t.trader_wallet)
          HAVING countDistinct(m.condition_id) >= 20
        )
        SELECT count(*) as cnt FROM wallet_stats ws
        WHERE ws.wallet IN (SELECT wallet FROM with_markets)
          AND (ws.trades / ws.days) <= 50
          AND (ws.volume / ws.trades) >= 50
      `
    },
    {
      name: '9. + ≥50 markets (experienced)',
      query: `
        WITH active AS (
          SELECT DISTINCT lower(trader_wallet) as wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
        ),
        wallet_stats AS (
          SELECT
            lower(trader_wallet) as wallet,
            count(*) as trades,
            sum(usdc_amount)/1e6 as volume,
            dateDiff('day', min(trade_time), max(trade_time)) + 1 as days
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active)
          GROUP BY lower(trader_wallet)
          HAVING volume >= 200 AND trades >= 30
        ),
        with_markets AS (
          SELECT lower(t.trader_wallet) as wallet, countDistinct(m.condition_id) as markets
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE t.is_deleted = 0 AND lower(t.trader_wallet) IN (SELECT wallet FROM wallet_stats)
          GROUP BY lower(t.trader_wallet)
          HAVING markets >= 50
        )
        SELECT count(*) as cnt FROM wallet_stats ws
        WHERE ws.wallet IN (SELECT wallet FROM with_markets)
          AND (ws.trades / ws.days) <= 50
          AND (ws.volume / ws.trades) >= 50
      `
    }
  ];

  console.log('Running funnel breakdown (this may take a few minutes)...\n');

  let prevCount = 0;

  for (const q of queries) {
    const startTime = Date.now();
    console.log(`${q.name}...`);

    try {
      const result = await clickhouse.query({
        query: q.query,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 300 }
      });
      const rows = await result.json() as any[];
      const count = rows[0]?.cnt || 0;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      const reduction = prevCount > 0 ? ((prevCount - count) / prevCount * 100).toFixed(1) : '0';
      const pctOfPrev = prevCount > 0 ? (count / prevCount * 100).toFixed(1) : '100';

      console.log(`   → ${count.toLocaleString()} wallets (${pctOfPrev}% of prev, -${reduction}%) [${elapsed}s]\n`);
      prevCount = count;
    } catch (e: any) {
      console.log(`   → ERROR: ${e.message}\n`);
    }
  }

  console.log('='.repeat(70));
  console.log('FUNNEL COMPLETE');
  console.log('='.repeat(70));
}

filterFunnel().catch(console.error);
