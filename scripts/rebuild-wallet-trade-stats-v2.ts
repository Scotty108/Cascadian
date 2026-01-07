/**
 * Rebuild pm_wallet_trade_stats with simpler INSERT
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Rebuilding pm_wallet_trade_stats ===\n');

  // Check current state
  const check1 = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_wallet_trade_stats',
    format: 'JSONEachRow'
  });
  const rows1 = await check1.json() as any[];
  console.log(`Current rows: ${rows1[0]?.cnt}`);

  // Simpler aggregation without nested GROUP BY
  console.log('\nInserting fresh data (may take 5-10 min)...');
  const startTime = Date.now();

  const insertQuery = `
    INSERT INTO pm_wallet_trade_stats
    SELECT
      lower(trader_wallet) as wallet,
      countIf(role = 'maker') as maker_count,
      countIf(role = 'taker') as taker_count,
      count() as total_count,
      sumIf(usdc_amount, role = 'maker') / 1e6 as maker_usdc,
      sumIf(usdc_amount, role = 'taker') / 1e6 as taker_usdc,
      sum(usdc_amount) / 1e6 as total_usdc,
      min(trade_time) as first_trade_time,
      max(trade_time) as last_trade_time,
      countIf(role = 'taker') / count() as taker_ratio,
      now() as computed_at
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY lower(trader_wallet)
    SETTINGS max_execution_time = 1200
  `;

  await clickhouse.command({ query: insertQuery });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s`);

  // Verify
  const check2 = await clickhouse.query({
    query: `
      SELECT count() as cnt, max(last_trade_time) as latest, max(computed_at) as computed
      FROM pm_wallet_trade_stats
    `,
    format: 'JSONEachRow'
  });
  const rows2 = await check2.json() as any[];
  console.log(`\n✅ New rows: ${Number(rows2[0]?.cnt).toLocaleString()}`);
  console.log(`Latest trade: ${rows2[0]?.latest}`);
  console.log(`Computed at: ${rows2[0]?.computed}`);
}

main().catch(console.error);
