/**
 * Backfill pm_canonical_fills_v4 - FIXED VERSION
 *
 * Issue with v4: Processing by month caused memory issues with self-fill CTE
 * Fix: Process by DAY instead of month for more reliable execution
 *
 * This script only backfills CLOB data since that's where the gap is.
 * CTF and NegRisk data appears complete.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Date range - full history
const START_DATE = '2022-11-01';
const END_DATE = '2026-01-14'; // Today + 1

interface DayRange {
  start: string;
  end: string;
  label: string;
}

function generateDays(startDate: string, endDate: string): DayRange[] {
  const days: DayRange[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let current = new Date(start);
  while (current < end) {
    const dayStart = current.toISOString().slice(0, 10);
    const nextDay = new Date(current);
    nextDay.setDate(nextDay.getDate() + 1);
    const dayEnd = nextDay.toISOString().slice(0, 10);

    days.push({
      start: dayStart,
      end: dayEnd,
      label: dayStart
    });

    current = nextDay;
  }
  return days;
}

async function getExpectedCount(day: DayRange): Promise<number> {
  // Count what SHOULD be in canonical fills for this day
  // IMPORTANT: pm_trader_events_v3 has duplicate event_ids from historical backfills
  // Must deduplicate by event_id first, then apply self-fill logic
  const query = `
    WITH
    deduped AS (
      SELECT
        event_id,
        any(trader_wallet) as d_wallet,
        any(transaction_hash) as d_tx_hash,
        any(token_id) as d_token_id,
        any(side) as d_side,
        any(role) as d_role,
        any(usdc_amount) as d_usdc_amount,
        any(token_amount) as d_token_amount,
        any(trade_time) as d_trade_time,
        any(block_number) as d_block_number
      FROM pm_trader_events_v3
      WHERE trade_time >= '${day.start}' AND trade_time < '${day.end}'
      GROUP BY event_id
    ),
    self_fill_txs AS (
      SELECT d_wallet as sf_wallet, d_tx_hash as sf_tx
      FROM deduped
      GROUP BY d_wallet, d_tx_hash
      HAVING countIf(d_role = 'maker') > 0 AND countIf(d_role = 'taker') > 0
    )
    SELECT count() as cnt
    FROM deduped t
    JOIN pm_token_to_condition_map_v5 m ON t.d_token_id = m.token_id_dec
    LEFT JOIN self_fill_txs sf ON t.d_wallet = sf.sf_wallet AND t.d_tx_hash = sf.sf_tx
    WHERE m.condition_id != ''
      AND NOT (sf.sf_wallet != '' AND t.d_role = 'maker')
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows[0]?.cnt || 0;
}

async function getActualCount(day: DayRange): Promise<number> {
  const query = `
    SELECT count() as cnt
    FROM pm_canonical_fills_v4
    WHERE source = 'clob'
      AND event_time >= '${day.start}'
      AND event_time < '${day.end}'
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows[0]?.cnt || 0;
}

async function deleteDay(day: DayRange): Promise<void> {
  // Delete existing data for this day to allow clean re-insert
  const query = `
    ALTER TABLE pm_canonical_fills_v4
    DELETE WHERE source = 'clob'
      AND event_time >= '${day.start}'
      AND event_time < '${day.end}'
  `;
  await clickhouse.command({ query });

  // Wait for mutation to complete
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function backfillDay(day: DayRange): Promise<number> {
  // IMPORTANT: pm_trader_events_v3 has duplicate event_ids from historical backfills
  // Must deduplicate by event_id first, then apply self-fill logic
  const query = `
    INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
    WITH
    deduped AS (
      SELECT
        event_id,
        any(trader_wallet) as d_wallet,
        any(transaction_hash) as d_tx_hash,
        any(token_id) as d_token_id,
        any(side) as d_side,
        any(role) as d_role,
        any(usdc_amount) as d_usdc_amount,
        any(token_amount) as d_token_amount,
        any(trade_time) as d_trade_time,
        any(block_number) as d_block_number
      FROM pm_trader_events_v3
      WHERE trade_time >= '${day.start}' AND trade_time < '${day.end}'
      GROUP BY event_id
    ),
    self_fill_txs AS (
      SELECT d_wallet as sf_wallet, d_tx_hash as sf_tx
      FROM deduped
      GROUP BY d_wallet, d_tx_hash
      HAVING countIf(d_role = 'maker') > 0 AND countIf(d_role = 'taker') > 0
    )
    SELECT
      concat('clob_', t.event_id) as fill_id,
      t.d_trade_time as event_time,
      t.d_block_number as block_number,
      t.d_tx_hash as tx_hash,
      lower(t.d_wallet) as wallet,
      m.condition_id,
      m.outcome_index,
      CASE WHEN t.d_side = 'buy' THEN t.d_token_amount / 1e6 ELSE -t.d_token_amount / 1e6 END as tokens_delta,
      CASE WHEN t.d_side = 'buy' THEN -t.d_usdc_amount / 1e6 ELSE t.d_usdc_amount / 1e6 END as usdc_delta,
      'clob' as source,
      sf.sf_wallet != '' as is_self_fill,
      t.d_role = 'maker' as is_maker
    FROM deduped t
    JOIN pm_token_to_condition_map_v5 m ON t.d_token_id = m.token_id_dec
    LEFT JOIN self_fill_txs sf ON t.d_wallet = sf.sf_wallet AND t.d_tx_hash = sf.sf_tx
    WHERE m.condition_id != ''
      AND NOT (sf.sf_wallet != '' AND t.d_role = 'maker')
  `;

  await clickhouse.command({ query });

  // Get count for verification
  return await getActualCount(day);
}

async function main() {
  const startTime = Date.now();
  const forceRerun = process.argv.includes('--force');
  const startFrom = process.argv.find(a => a.startsWith('--start='))?.split('=')[1];

  console.log('=== BACKFILL pm_canonical_fills_v4 (CLOB only, by day) ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Force rerun: ${forceRerun}`);
  if (startFrom) console.log(`Starting from: ${startFrom}`);

  const allDays = generateDays(START_DATE, END_DATE);
  const days = startFrom
    ? allDays.filter(d => d.start >= startFrom)
    : allDays;

  console.log(`\nProcessing ${days.length} days...\n`);

  let totalInserted = 0;
  let daysProcessed = 0;
  let daysSkipped = 0;
  let daysFailed = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const dayStart = Date.now();

    process.stdout.write(`[${i + 1}/${days.length}] ${day.label}: `);

    try {
      // Check expected vs actual
      const expected = await getExpectedCount(day);
      const actual = await getActualCount(day);

      if (expected === 0) {
        console.log('no trades, skipping');
        daysSkipped++;
        continue;
      }

      const coverage = actual / expected;

      // Skip if coverage is good (>95%) unless force rerun
      if (coverage >= 0.95 && !forceRerun) {
        console.log(`OK (${(coverage * 100).toFixed(1)}% coverage, ${actual.toLocaleString()} rows)`);
        daysSkipped++;
        totalInserted += actual;
        continue;
      }

      // Need to backfill - delete and re-insert
      process.stdout.write(`gap detected (${(coverage * 100).toFixed(1)}%), rebuilding... `);

      if (actual > 0) {
        await deleteDay(day);
        process.stdout.write('deleted... ');
      }

      const inserted = await backfillDay(day);
      const newCoverage = inserted / expected;

      if (newCoverage >= 0.95) {
        console.log(`FIXED (${inserted.toLocaleString()} rows, ${(newCoverage * 100).toFixed(1)}%)`);
        daysProcessed++;
        totalInserted += inserted;
      } else {
        console.log(`PARTIAL (${inserted.toLocaleString()}/${expected.toLocaleString()}, ${(newCoverage * 100).toFixed(1)}%)`);
        daysFailed++;
        totalInserted += inserted;
      }
    } catch (e: any) {
      console.log(`ERROR: ${e.message?.slice(0, 100)}`);
      daysFailed++;
    }

    // Progress update every 100 days
    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = (i + 1) / elapsed;
      const remaining = (days.length - i - 1) / rate;
      console.log(`  Progress: ${i + 1}/${days.length} days, ${elapsed.toFixed(1)}m elapsed, ~${remaining.toFixed(1)}m remaining`);
    }
  }

  // Final summary
  const totalTime = (Date.now() - startTime) / 1000 / 60;

  console.log('\n=== BACKFILL COMPLETE ===');
  console.log(`Total time: ${totalTime.toFixed(1)} minutes`);
  console.log(`Days processed: ${daysProcessed}`);
  console.log(`Days skipped (already OK): ${daysSkipped}`);
  console.log(`Days with issues: ${daysFailed}`);
  console.log(`Total CLOB rows: ${totalInserted.toLocaleString()}`);

  // Verify final counts
  console.log('\nFinal verification...');
  const finalCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'clob'`,
    format: 'JSONEachRow'
  });
  const finalRows = await finalCount.json() as any[];
  console.log(`Canonical fills CLOB rows: ${finalRows[0]?.cnt?.toLocaleString()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
