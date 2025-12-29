/**
 * Build Latest Mark Price View
 *
 * Creates a materialized view that stores the latest trade price for each
 * (condition_id, outcome_index) pair from CLOB trades.
 *
 * This replaces the 0.5 constant mark price for unresolved positions.
 *
 * Usage:
 *   npx tsx scripts/pnl/build-mark-price-view.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               BUILD LATEST MARK PRICE VIEW                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Drop existing table/view if exists
  console.log('Step 1: Dropping existing table if exists...');
  try {
    await clickhouse.command({
      query: 'DROP TABLE IF EXISTS pm_latest_mark_price_v1'
    });
    console.log('  Dropped pm_latest_mark_price_v1 (if existed)\n');
  } catch (e: any) {
    console.log('  Note:', e.message.slice(0, 100));
  }

  // Step 2: Create the table with latest price per (condition_id, outcome_index)
  console.log('Step 2: Creating pm_latest_mark_price_v1 table...');

  const createTableSQL = `
    CREATE TABLE pm_latest_mark_price_v1
    ENGINE = ReplacingMergeTree()
    ORDER BY (condition_id, outcome_index)
    AS
    SELECT
      condition_id,
      outcome_index,
      argMax(
        abs(usdc_delta) / nullIf(abs(token_delta), 0),
        (event_time, event_id)
      ) AS mark_price,
      max(event_time) AS last_trade_time,
      count() AS trade_count
    FROM pm_unified_ledger_v9_clob_tbl
    WHERE source_type = 'CLOB'
      AND condition_id IS NOT NULL
      AND condition_id != ''
      AND token_delta != 0
    GROUP BY condition_id, outcome_index
  `;

  try {
    await clickhouse.command({ query: createTableSQL });
    console.log('  Created pm_latest_mark_price_v1 table\n');
  } catch (e: any) {
    console.error('  Error creating table:', e.message);
    process.exit(1);
  }

  // Step 3: Verify the table
  console.log('Step 3: Verifying table...');

  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_latest_mark_price_v1',
    format: 'JSONEachRow'
  });
  const countRow = (await countResult.json() as any[])[0];
  console.log(`  Total rows: ${Number(countRow.cnt).toLocaleString()}\n`);

  // Step 4: Show sample data
  console.log('Step 4: Sample mark prices...');

  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        outcome_index,
        round(mark_price, 4) as mark_price,
        last_trade_time,
        trade_count
      FROM pm_latest_mark_price_v1
      WHERE mark_price > 0 AND mark_price < 1
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json() as any[];

  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ condition_id (first 20)    │ idx │ mark    │ last_trade          │ trades   │');
  console.log('├──────────────────────────────────────────────────────────────────────────────┤');
  for (const s of samples) {
    const cid = s.condition_id.slice(0, 20);
    const idx = String(s.outcome_index).padStart(3);
    const price = String(s.mark_price).padStart(7);
    const time = s.last_trade_time.slice(0, 19);
    const trades = String(s.trade_count).padStart(8);
    console.log(`│ ${cid}... │ ${idx} │ ${price} │ ${time} │ ${trades} │`);
  }
  console.log('└──────────────────────────────────────────────────────────────────────────────┘\n');

  // Step 5: Show price distribution
  console.log('Step 5: Mark price distribution...');

  const distResult = await clickhouse.query({
    query: `
      SELECT
        countIf(mark_price < 0.1) as below_10,
        countIf(mark_price >= 0.1 AND mark_price < 0.3) as range_10_30,
        countIf(mark_price >= 0.3 AND mark_price < 0.5) as range_30_50,
        countIf(mark_price >= 0.5 AND mark_price < 0.7) as range_50_70,
        countIf(mark_price >= 0.7 AND mark_price < 0.9) as range_70_90,
        countIf(mark_price >= 0.9 AND mark_price <= 1.0) as range_90_100,
        countIf(mark_price > 1.0 OR mark_price < 0) as outliers,
        countIf(mark_price IS NULL OR isNaN(mark_price)) as invalid
      FROM pm_latest_mark_price_v1
    `,
    format: 'JSONEachRow'
  });
  const dist = (await distResult.json() as any[])[0];

  console.log('  < 0.10:     ' + String(dist.below_10).padStart(10));
  console.log('  0.10-0.30:  ' + String(dist.range_10_30).padStart(10));
  console.log('  0.30-0.50:  ' + String(dist.range_30_50).padStart(10));
  console.log('  0.50-0.70:  ' + String(dist.range_50_70).padStart(10));
  console.log('  0.70-0.90:  ' + String(dist.range_70_90).padStart(10));
  console.log('  0.90-1.00:  ' + String(dist.range_90_100).padStart(10));
  console.log('  Outliers:   ' + String(dist.outliers).padStart(10));
  console.log('  Invalid:    ' + String(dist.invalid).padStart(10));

  console.log('\n✅ pm_latest_mark_price_v1 table created successfully');
  console.log('\nUsage in V20b engine:');
  console.log('  JOIN pm_latest_mark_price_v1 mp ON (l.condition_id = mp.condition_id AND l.outcome_index = mp.outcome_index)');
  console.log('  settlement_price = if(payout_norm IS NOT NULL, payout_norm, coalesce(mp.mark_price, 0.5))');
}

main().catch(console.error);
