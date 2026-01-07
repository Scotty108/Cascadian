/**
 * Refresh pm_wallet_trade_stats table
 *
 * Aggregates trade stats from pm_trader_events_v2 (deduped by event_id)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Refreshing pm_wallet_trade_stats ===\n');

  // Step 1: Check current state
  const checkQuery = `
    SELECT
      count() as rows,
      max(last_trade_time) as latest_trade,
      max(computed_at) as computed
    FROM pm_wallet_trade_stats
  `;
  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const checkRows = await checkResult.json() as any[];
  console.log('Current state:');
  console.log(`  Rows: ${Number(checkRows[0]?.rows).toLocaleString()}`);
  console.log(`  Latest trade: ${checkRows[0]?.latest_trade}`);
  console.log(`  Computed at: ${checkRows[0]?.computed}`);
  console.log('');

  // Step 2: Truncate and rebuild
  console.log('Truncating table...');
  await clickhouse.command({ query: 'TRUNCATE TABLE pm_wallet_trade_stats' });

  // Step 3: Insert fresh data
  console.log('Rebuilding from pm_trader_events_v2 (this may take a few minutes)...');
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
    FROM (
      SELECT
        trader_wallet,
        role,
        usdc_amount,
        trade_time
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY event_id, trader_wallet, role, usdc_amount, trade_time
    )
    GROUP BY lower(trader_wallet)
  `;

  await clickhouse.command({
    query: insertQuery,
    clickhouse_settings: {
      max_execution_time: 600,  // 10 min timeout
      max_memory_usage: 20000000000,  // 20GB
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s\n`);

  // Step 4: Verify
  const verifyResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const verifyRows = await verifyResult.json() as any[];
  console.log('New state:');
  console.log(`  Rows: ${Number(verifyRows[0]?.rows).toLocaleString()}`);
  console.log(`  Latest trade: ${verifyRows[0]?.latest_trade}`);
  console.log(`  Computed at: ${verifyRows[0]?.computed}`);
}

main().catch(console.error);
