#!/usr/bin/env npx tsx
/**
 * Build a precomputed wallet flatness table
 *
 * This creates `pm_wallet_flatness_v1` with:
 *   - wallet: address
 *   - max_abs_net_shares: max(abs(net_shares)) across all positions
 *   - is_flat: whether max_abs_net_shares <= FLAT_EPSILON
 *   - position_count: number of distinct (condition_id, outcome_index) positions
 *
 * Run once to precompute, then use for efficient flat wallet filtering.
 *
 * Usage:
 *   npx tsx scripts/pnl/build-wallet-flatness-table.ts
 *   npx tsx scripts/pnl/build-wallet-flatness-table.ts --drop  # Drop and rebuild
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes
});

const FLAT_EPSILON = 0.000001;
const TABLE_NAME = 'pm_wallet_flatness_v1';

async function buildTable(drop: boolean) {
  console.log('='.repeat(80));
  console.log('BUILD WALLET FLATNESS TABLE');
  console.log('='.repeat(80));

  if (drop) {
    console.log(`\nDropping existing table ${TABLE_NAME}...`);
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TABLE_NAME}` });
    console.log('  Done.');
  }

  // Check if table exists
  const existsResult = await clickhouse.query({
    query: `SELECT count() as c FROM system.tables WHERE name = '${TABLE_NAME}' AND database = currentDatabase()`,
    format: 'JSONEachRow',
  });
  const existsRows = (await existsResult.json()) as any[];

  if (existsRows[0].c > 0) {
    console.log(`\nTable ${TABLE_NAME} already exists.`);
    const countResult = await clickhouse.query({
      query: `SELECT count() as c FROM ${TABLE_NAME}`,
      format: 'JSONEachRow',
    });
    const countRows = (await countResult.json()) as any[];
    console.log(`  Row count: ${countRows[0].c}`);

    const flatResult = await clickhouse.query({
      query: `SELECT countIf(is_flat = 1) as flat, countIf(is_flat = 0) as not_flat FROM ${TABLE_NAME}`,
      format: 'JSONEachRow',
    });
    const flatRows = (await flatResult.json()) as any[];
    console.log(`  Flat wallets: ${flatRows[0].flat}`);
    console.log(`  Not flat: ${flatRows[0].not_flat}`);

    console.log('\nUse --drop to rebuild.');
    return;
  }

  console.log(`\nBuilding ${TABLE_NAME}...`);
  console.log('This computes net shares across ALL fills. May take several minutes.');

  // Build the table using CREATE TABLE AS SELECT
  // Uses the same GROUP BY event_id dedup pattern
  const createQuery = `
    CREATE TABLE ${TABLE_NAME}
    ENGINE = MergeTree()
    ORDER BY wallet
    AS
    SELECT
      wallet,
      max(abs(net_shares)) as max_abs_net_shares,
      if(max(abs(net_shares)) <= ${FLAT_EPSILON}, 1, 0) as is_flat,
      count() as position_count
    FROM (
      SELECT
        wallet,
        condition_id,
        outcome_index,
        sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_shares
      FROM (
        SELECT
          f.event_id,
          lower(f.trader_wallet) as wallet,
          any(lower(f.side)) as side,
          any(f.token_amount) as token_amount,
          any(m.condition_id) as condition_id,
          any(m.outcome_index) as outcome_index
        FROM pm_trader_events_dedup_v2_tbl f
        INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
        GROUP BY f.event_id, f.trader_wallet
      )
      GROUP BY wallet, condition_id, outcome_index
    )
    GROUP BY wallet
  `;

  console.log('\nExecuting CREATE TABLE AS SELECT...');
  const startTime = Date.now();

  try {
    await clickhouse.command({ query: createQuery });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Done in ${elapsed}s`);

    // Get stats
    const countResult = await clickhouse.query({
      query: `SELECT count() as c FROM ${TABLE_NAME}`,
      format: 'JSONEachRow',
    });
    const countRows = (await countResult.json()) as any[];
    console.log(`\nTable created with ${countRows[0].c} wallets.`);

    const flatResult = await clickhouse.query({
      query: `SELECT countIf(is_flat = 1) as flat, countIf(is_flat = 0) as not_flat FROM ${TABLE_NAME}`,
      format: 'JSONEachRow',
    });
    const flatRows = (await flatResult.json()) as any[];
    console.log(`  Flat wallets: ${flatRows[0].flat}`);
    console.log(`  Not flat: ${flatRows[0].not_flat}`);

    // Sample some flat wallets
    console.log('\nSample flat wallets:');
    const sampleResult = await clickhouse.query({
      query: `SELECT wallet, max_abs_net_shares, position_count FROM ${TABLE_NAME} WHERE is_flat = 1 LIMIT 5`,
      format: 'JSONEachRow',
    });
    const sampleRows = (await sampleResult.json()) as any[];
    sampleRows.forEach((r: any) => {
      console.log(`  ${r.wallet}: ${r.position_count} positions, max_abs=${r.max_abs_net_shares}`);
    });

  } catch (e: any) {
    console.error('Error creating table:', e.message?.slice(0, 500));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const drop = args.includes('--drop');

  await buildTable(drop);
  await clickhouse.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
