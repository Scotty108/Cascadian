/**
 * Rebuild pm_wallet_trade_stats using atomic swap
 * More efficient than INSERT INTO for large datasets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Rebuilding pm_wallet_trade_stats (atomic) ===\n');

  // Step 1: Create temp table with fresh data
  console.log('Step 1: Creating temp table with fresh aggregation...');
  console.log('(This runs async on ClickHouse server - may take 5-10 min)\n');

  const startTime = Date.now();

  // Drop temp table if exists
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_wallet_trade_stats_new' });

  // Create new table with data (runs server-side)
  const createQuery = `
    CREATE TABLE pm_wallet_trade_stats_new
    ENGINE = ReplacingMergeTree()
    ORDER BY wallet
    AS
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

  try {
    await clickhouse.command({
      query: createQuery,
      clickhouse_settings: {
        max_execution_time: 1200,  // 20 min
        send_progress_in_http_headers: 1,
      }
    });
  } catch (err: any) {
    if (err.message?.includes('Timeout')) {
      console.log('Client timeout - but query may still be running on server.');
      console.log('Checking server-side...');

      // Wait and check
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 10000)); // Wait 10s
        try {
          const check = await clickhouse.query({
            query: 'SELECT count() as cnt FROM pm_wallet_trade_stats_new',
            format: 'JSONEachRow'
          });
          const rows = await check.json() as any[];
          const cnt = Number(rows[0]?.cnt);
          if (cnt > 0) {
            console.log(`Table ready with ${cnt.toLocaleString()} rows!`);
            break;
          }
        } catch {
          console.log(`Waiting... (${(i + 1) * 10}s)`);
        }
      }
    } else {
      throw err;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Create took ${elapsed}s`);

  // Step 2: Verify new table
  const verifyQuery = `
    SELECT count() as rows, max(last_trade_time) as latest
    FROM pm_wallet_trade_stats_new
  `;
  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const verifyRows = await verifyResult.json() as any[];
  console.log(`\nNew table: ${Number(verifyRows[0]?.rows).toLocaleString()} rows`);
  console.log(`Latest trade: ${verifyRows[0]?.latest}`);

  if (Number(verifyRows[0]?.rows) === 0) {
    console.log('\n❌ New table is empty! Aborting swap.');
    return;
  }

  // Step 3: Atomic swap
  console.log('\nStep 2: Atomic swap...');
  await clickhouse.command({
    query: 'EXCHANGE TABLES pm_wallet_trade_stats AND pm_wallet_trade_stats_new'
  });
  console.log('Swap complete!');

  // Step 4: Drop old table
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_wallet_trade_stats_new' });

  // Step 5: Final verify
  const finalQuery = `
    SELECT count() as rows, max(last_trade_time) as latest, max(computed_at) as computed
    FROM pm_wallet_trade_stats
  `;
  const finalResult = await clickhouse.query({ query: finalQuery, format: 'JSONEachRow' });
  const finalRows = await finalResult.json() as any[];
  console.log(`\n✅ Final: ${Number(finalRows[0]?.rows).toLocaleString()} rows`);
  console.log(`Latest trade: ${finalRows[0]?.latest}`);
  console.log(`Computed at: ${finalRows[0]?.computed}`);
}

main().catch(console.error);
