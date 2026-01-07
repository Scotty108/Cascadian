/**
 * Simple count - just your filter
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Copy Trade Pool Count ===\n');
  console.log('Filter: 14+ days old, 10+ trades, active in last 7 days\n');

  // Simpler query - just your exact filter
  const query = `
    SELECT count() as cnt
    FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count(DISTINCT event_id) as trades,
        dateDiff('day', min(trade_time), max(trade_time)) as wallet_age_days,
        dateDiff('day', max(trade_time), now()) as days_since_last_trade
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING
        wallet_age_days >= 14
        AND trades >= 10
        AND days_since_last_trade <= 7
    )
  `;

  console.log('Running query...');
  const startTime = Date.now();

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 300  // 5 min timeout
    }
  });
  const rows = await result.json() as any[];

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const count = Number(rows[0]?.cnt || 0);

  console.log(`Query time: ${elapsed}s\n`);
  console.log(`>>> ${count.toLocaleString()} wallets <<<\n`);
  console.log(`Est. CCR-v1 runtime @ 1/sec: ${(count / 3600).toFixed(1)} hours`);
  console.log(`Est. CCR-v1 runtime @ 2/sec: ${(count / 7200).toFixed(1)} hours`);
}

main().catch(console.error);
