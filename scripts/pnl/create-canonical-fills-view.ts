#!/usr/bin/env npx tsx
/**
 * Create pm_trader_fills_canonical_v1 - properly deduped fills view
 * ============================================================================
 *
 * Fixes Bug A: maker/taker duplication
 *
 * The same fill appears twice in pm_trader_events_v2:
 *   - Once with role='maker' and event_id ending in '-m'
 *   - Once with role='taker' and event_id ending in '-t'
 *
 * This view dedupes by FILL SIGNATURE (not event_id), keeping exactly 1 row.
 *
 * Dedup key (fill signature):
 *   - trader_wallet
 *   - transaction_hash
 *   - token_id
 *   - side
 *   - token_amount
 *   - usdc_amount
 *   - fee_amount
 *   - trade_time
 *
 * Tie-breaker: argMax by insert_time (keep latest insert)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('Creating pm_trader_fills_canonical_v1 view...\n');

  // Drop existing view if any
  try {
    await clickhouse.command({
      query: 'DROP VIEW IF EXISTS pm_trader_fills_canonical_v1',
    });
    console.log('Dropped existing view (if any)');
  } catch (e) {
    console.log('No existing view to drop');
  }

  // Create the canonical fills view
  // Note: Using subquery to avoid column name conflicts with GROUP BY
  const createViewSQL = `
    CREATE VIEW pm_trader_fills_canonical_v1 AS
    SELECT
      -- Keep one representative event_id for reference
      argMax(event_id, insert_time) AS event_id,
      trader_wallet,
      transaction_hash,
      token_id,
      side,
      token_amount,
      usdc_amount,
      fee_amount,
      trade_time,
      -- Keep useful metadata
      argMax(role, insert_time) AS role,
      max(block_number) AS block_number,
      max(insert_time) AS latest_insert_time
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY
      -- Fill signature (dedup key)
      trader_wallet,
      transaction_hash,
      token_id,
      side,
      token_amount,
      usdc_amount,
      fee_amount,
      trade_time
  `;

  await clickhouse.command({ query: createViewSQL });
  console.log('Created pm_trader_fills_canonical_v1 view\n');

  // Verify: count rows before/after
  console.log('=== Verification ===\n');

  const rawCount = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0',
    format: 'JSONEachRow',
  });
  const rawRow = (await rawCount.json())[0] as any;
  console.log('Raw pm_trader_events_v2 rows:     ' + Number(rawRow.cnt).toLocaleString());

  const dedupCount = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_fills_canonical_v1',
    format: 'JSONEachRow',
  });
  const dedupRow = (await dedupCount.json())[0] as any;
  console.log('Deduped canonical fills rows:    ' + Number(dedupRow.cnt).toLocaleString());

  const reduction = ((rawRow.cnt - dedupRow.cnt) / rawRow.cnt * 100).toFixed(1);
  console.log('Reduction:                       ' + reduction + '%');

  // Check role distribution in deduped view
  console.log('\n=== Role distribution after dedup ===');
  const roles = await clickhouse.query({
    query: 'SELECT role, count() as cnt FROM pm_trader_fills_canonical_v1 GROUP BY role',
    format: 'JSONEachRow',
  });
  const roleRows = (await roles.json()) as any[];
  for (const r of roleRows) {
    console.log('  ' + r.role + ': ' + Number(r.cnt).toLocaleString());
  }

  // Test on known failing wallet
  const testWallet = '0x8677df7105d1146eecf515fa00a88a83a661cd6a';
  console.log('\n=== Test on failing wallet: ' + testWallet.slice(0, 10) + '... ===');

  const beforeQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_v2 WHERE trader_wallet = '${testWallet}' AND is_deleted = 0`,
    format: 'JSONEachRow',
  });
  const beforeRow = (await beforeQ.json())[0] as any;

  const afterQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_fills_canonical_v1 WHERE trader_wallet = '${testWallet}'`,
    format: 'JSONEachRow',
  });
  const afterRow = (await afterQ.json())[0] as any;

  console.log('  Before (raw):   ' + beforeRow.cnt + ' rows');
  console.log('  After (dedup):  ' + afterRow.cnt + ' rows');
  console.log('  Removed:        ' + (beforeRow.cnt - afterRow.cnt) + ' duplicates');

  await clickhouse.close();
  console.log('\nDone!');
}

main().catch(console.error);
