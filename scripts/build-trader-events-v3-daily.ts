/**
 * V3 Gap Filler - DAILY chunks to avoid timeouts
 * For massive weeks that timeout with weekly processing
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const NEW_TABLE = 'pm_trader_events_v3';

async function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function getMissingDays(): Promise<Array<{ day: string; rows: number }>> {
  const q = await clickhouse.query({
    query: `
      SELECT
        toString(toDate(trade_time)) as day,
        count() as rows
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND toDate(trade_time) NOT IN (
          SELECT DISTINCT toDate(trade_time) FROM ${NEW_TABLE}
        )
      GROUP BY day
      ORDER BY day
    `,
    format: 'JSONEachRow'
  });
  return await q.json() as any[];
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
        max_execution_time: 600,  // 10 min per day (should be plenty)
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

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  V3 GAP FILLER - Daily chunks for massive weeks          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const missing = await getMissingDays();
  log(`Found ${missing.length} missing days`);

  const totalSourceRows = missing.reduce((sum, d) => sum + d.rows, 0);
  log(`Total source rows to process: ${totalSourceRows.toLocaleString()}\n`);

  if (missing.length === 0) {
    log('All days are loaded!');
    return;
  }

  const startTime = Date.now();
  let processedRows = 0;
  let errors = 0;

  for (let i = 0; i < missing.length; i++) {
    const { day, rows: sourceRows } = missing[i];
    const result = await processDay(day);

    if (result.error) {
      log(`✗ ${day} (${sourceRows.toLocaleString()} src): ${result.error}`);
      errors++;
    } else {
      processedRows += result.rows;
      const elapsed = (Date.now() - startTime) / 1000;
      const rowRate = processedRows / elapsed;
      const remainingRows = totalSourceRows - processedRows;
      const eta = remainingRows > 0 ? Math.round(remainingRows / rowRate / 60) : 0;

      // Only log every day or every 10 days for quieter output
      if (i < 10 || (i + 1) % 10 === 0 || i === missing.length - 1) {
        log(`✓ ${day}: ${result.rows.toLocaleString()} | Total: ${processedRows.toLocaleString()} | ${Math.round(rowRate).toLocaleString()}/s | ETA: ${eta}m`);
      }
    }

    // Progress every 20 days
    if ((i + 1) % 20 === 0) {
      const pct = ((i + 1) / missing.length * 100).toFixed(1);
      log(`--- Progress: ${i + 1}/${missing.length} days (${pct}%) ---`);
    }
  }

  log('\n=== COMPLETE ===');
  const finalQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${NEW_TABLE}`,
    format: 'JSONEachRow'
  });
  log(`Final v3 count: ${((await finalQ.json() as any[])[0]?.cnt || 0).toLocaleString()}`);
  log(`Errors: ${errors}`);
  log(`Time: ${Math.round((Date.now() - startTime) / 60000)} minutes`);

  // Setup MV for live sync
  log('\nSetting up live sync...');
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
    log('Live sync MV created.');
  } catch (e: any) {
    log('MV failed: ' + e.message?.slice(0, 100));
  }
}

main().catch(console.error);
