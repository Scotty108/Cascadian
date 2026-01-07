/**
 * Create leaderboard cache table
 *
 * This table stores pre-computed CCR-v1 metrics for instant leaderboard queries.
 * Updated by batch job every 6-12 hours.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const TABLE_NAME = 'pm_wallet_pnl_leaderboard_cache';

async function main() {
  console.log(`Creating ${TABLE_NAME}...`);

  // Drop if exists
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TABLE_NAME}` });

  // Create table
  const createQuery = `
    CREATE TABLE ${TABLE_NAME} (
      wallet String,
      realized_pnl Float64,
      unrealized_pnl Float64,
      total_pnl Float64,
      volume_traded Float64,
      avg_return_pct Float64,
      win_rate Float64,
      win_count UInt32,
      loss_count UInt32,
      positions_count UInt32,
      resolved_count UInt32,
      external_sell_ratio Float64,
      pnl_confidence String,
      markets_last_30d UInt32,
      last_trade_time DateTime,
      computed_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(computed_at)
    ORDER BY wallet
    SETTINGS index_granularity = 8192
  `;

  await clickhouse.command({ query: createQuery });
  console.log('Table created successfully.');

  // Verify
  const descRes = await clickhouse.query({
    query: `DESCRIBE ${TABLE_NAME}`,
    format: 'JSONEachRow',
  });
  const cols = (await descRes.json()) as { name: string; type: string }[];

  console.log('\nColumns:');
  for (const col of cols) {
    console.log(`  ${col.name}: ${col.type}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
