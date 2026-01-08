/**
 * V3 Final Gap Filler - Process the 6 remaining missing weeks
 * Uses WEEK-based check but processes DAY by DAY to avoid timeouts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const NEW_TABLE = 'pm_trader_events_v3';

// The actual missing weeks identified
const MISSING_WEEKS = [
  '2025-02-23',
  '2025-03-02',
  '2025-11-30',
  '2025-12-07',
  '2025-12-14',
  '2025-12-21'
];

async function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function processDay(dayStr: string): Promise<{ rows: number; error?: string }> {
  const startDate = dayStr;
  const endDate = new Date(new Date(dayStr + 'T00:00:00Z').getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    await clickhouse.command({
      query: `
        INSERT INTO ${NEW_TABLE}
        SELECT
          event_id,
          _tw as trader_wallet, _r as role, _s as side, _ti as token_id,
          _ua as usdc_amount, _ta as token_amount, _fa as fee_amount,
          _tt as trade_time, _th as transaction_hash, _bn as block_number,
          1 as _version
        FROM (
          SELECT
            event_id,
            any(trader_wallet) as _tw, any(role) as _r, any(side) as _s,
            any(token_id) as _ti, any(usdc_amount) as _ua, any(token_amount) as _ta,
            any(fee_amount) as _fa, any(trade_time) as _tt,
            any(transaction_hash) as _th, any(block_number) as _bn
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= '${startDate}' AND trade_time < '${endDate}'
          GROUP BY event_id
        )
      `,
      clickhouse_settings: {
        max_execution_time: 600,
        max_memory_usage: 15_000_000_000,
        max_bytes_before_external_group_by: 8_000_000_000
      }
    });

    const countQ = await clickhouse.query({
      query: `SELECT count() as cnt FROM ${NEW_TABLE} WHERE trade_time >= '${startDate}' AND trade_time < '${endDate}'`,
      format: 'JSONEachRow'
    });
    return { rows: (await countQ.json() as any[])[0]?.cnt || 0 };

  } catch (err: any) {
    return { rows: 0, error: err.message?.slice(0, 150) };
  }
}

function getDaysInWeek(weekStart: string): string[] {
  const days: string[] = [];
  const start = new Date(weekStart + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  V3 FINAL - Process 6 missing weeks (day by day)         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  log(`Processing ${MISSING_WEEKS.length} missing weeks...`);

  const startTime = Date.now();
  let totalRows = 0;
  let errors = 0;

  for (const weekStart of MISSING_WEEKS) {
    const days = getDaysInWeek(weekStart);
    log(`\nWeek ${weekStart}:`);

    let weekRows = 0;
    for (const day of days) {
      const result = await processDay(day);
      if (result.error) {
        log(`  ✗ ${day}: ${result.error}`);
        errors++;
      } else {
        weekRows += result.rows;
        log(`  ✓ ${day}: ${result.rows.toLocaleString()} rows`);
      }
    }
    totalRows += weekRows;
    log(`  Week total: ${weekRows.toLocaleString()} rows`);
  }

  log('\n=== COMPLETE ===');
  const finalQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${NEW_TABLE}`,
    format: 'JSONEachRow'
  });
  log(`Final v3 count: ${((await finalQ.json() as any[])[0]?.cnt || 0).toLocaleString()}`);
  log(`Added this run: ${totalRows.toLocaleString()}`);
  log(`Errors: ${errors}`);
  log(`Time: ${Math.round((Date.now() - startTime) / 60000)} minutes`);

  // Verify no more missing weeks
  const checkMissing = await clickhouse.query({
    query: `
      SELECT count(DISTINCT toStartOfWeek(trade_time)) as missing_weeks
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND toStartOfWeek(trade_time) NOT IN (SELECT DISTINCT toStartOfWeek(trade_time) FROM ${NEW_TABLE})
    `,
    format: 'JSONEachRow'
  });
  const remaining = (await checkMissing.json() as any[])[0]?.missing_weeks || 0;
  log(`Remaining missing weeks: ${remaining}`);

  if (remaining === 0) {
    // Setup MV for live sync
    log('\nSetting up live sync MV...');
    try {
      await clickhouse.command({ query: `DROP VIEW IF EXISTS pm_trader_events_v3_mv` });
      await clickhouse.command({
        query: `
          CREATE MATERIALIZED VIEW pm_trader_events_v3_mv TO ${NEW_TABLE}
          AS SELECT event_id, trader_wallet, role, side, token_id,
            usdc_amount, token_amount, fee_amount, trade_time,
            transaction_hash, block_number, 1 as _version
          FROM pm_trader_events_v2 WHERE is_deleted = 0
        `
      });
      log('✅ Live sync MV created - v3 will stay up to date!');
    } catch (e: any) {
      log('MV failed: ' + e.message?.slice(0, 100));
    }
  }
}

main().catch(console.error);
