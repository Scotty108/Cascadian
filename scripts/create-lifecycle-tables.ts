#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS cascadian_clean.position_lifecycle (
        wallet LowCardinality(String),
        market_cid String,
        outcome Int32,
        lot_id UInt64,
        opened_at DateTime64(3),
        closed_at Nullable(DateTime64(3)),
        hold_seconds UInt64,
        hold_days Float64,
        entry_qty Float64,
        entry_avg_price Float64,
        exit_qty Float64,
        exit_avg_price Nullable(Float64),
        realized_pnl Float64,
        duration_category LowCardinality(String),
        position_status LowCardinality(String),
        created_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(created_at)
      ORDER BY (wallet, market_cid, outcome, lot_id)
    `
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS cascadian_clean.wallet_time_metrics (
        wallet LowCardinality(String),
        positions_total UInt64,
        positions_closed UInt64,
        positions_open UInt64,
        avg_hold_hours Float64,
        median_hold_hours Float64,
        max_hold_hours Float64,
        min_hold_hours Float64,
        pct_held_lt_1d Float64,
        pct_held_1_7d Float64,
        pct_held_gt_7d Float64,
        pct_held_gt_30d Float64,
        count_intraday UInt64,
        count_short_term UInt64,
        count_medium_term UInt64,
        count_long_term UInt64,
        intraday_pnl Float64,
        short_term_pnl Float64,
        medium_term_pnl Float64,
        long_term_pnl Float64,
        intraday_volume_usd Float64,
        short_term_volume_usd Float64,
        medium_term_volume_usd Float64,
        long_term_volume_usd Float64,
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY wallet
    `
  });

  console.log('✓ Tables created successfully');
  await ch.close();
}

main().catch(console.error);
