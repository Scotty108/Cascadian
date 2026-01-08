/**
 * Fill Gaps Only - Process only weeks missing from v3
 */
import 'dotenv/config';
import { clickhouse } from '../lib/clickhouse/client';

const NEW_TABLE = 'pm_trader_events_v3';

async function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function getMissingWeeks(): Promise<Array<{ week: string; rows: number }>> {
  const q = await clickhouse.query({
    query: `
      SELECT
        toString(toStartOfWeek(trade_time)) as week,
        count() as rows
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND toStartOfWeek(trade_time) NOT IN (
          SELECT DISTINCT toStartOfWeek(trade_time) FROM ${NEW_TABLE}
        )
      GROUP BY week
      ORDER BY week
    `,
    format: 'JSONEachRow'
  });
  return await q.json() as any[];
}

async function processWeek(weekStart: string): Promise<{ rows: number; error?: string }> {
  const startDate = weekStart.slice(0, 10);
  const endDate = new Date(new Date(startDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
        max_execution_time: 1800,  // 30 min for huge weeks
        max_memory_usage: 15_000_000_000,  // 15GB
        max_bytes_before_external_group_by: 8_000_000_000
      }
    });

    const countQ = await clickhouse.query({
      query: `SELECT count() as cnt FROM ${NEW_TABLE} WHERE trade_time >= '${startDate}' AND trade_time < '${endDate}'`,
      format: 'JSONEachRow'
    });
    return { rows: (await countQ.json() as any[])[0]?.cnt || 0 };

  } catch (err: any) {
    return { rows: 0, error: err.message?.slice(0, 200) };
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  GAP FILLER - Process only missing weeks                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const missing = await getMissingWeeks();
  log(`Found ${missing.length} missing weeks`);

  const totalSourceRows = missing.reduce((sum, w) => sum + w.rows, 0);
  log(`Total source rows to process: ${totalSourceRows.toLocaleString()}\n`);

  const startTime = Date.now();
  let processedRows = 0;
  let errors = 0;

  for (let i = 0; i < missing.length; i++) {
    const { week, rows: sourceRows } = missing[i];
    const result = await processWeek(week);

    if (result.error) {
      log(`✗ ${week} (${sourceRows.toLocaleString()} source): ${result.error}`);
      errors++;
    } else {
      processedRows += result.rows;
      const elapsed = (Date.now() - startTime) / 1000;
      const rowRate = processedRows / elapsed;
      const remainingRows = totalSourceRows - processedRows;
      const eta = remainingRows > 0 ? Math.round(remainingRows / rowRate / 60) : 0;

      log(`✓ ${week}: ${result.rows.toLocaleString()} rows | Total: ${processedRows.toLocaleString()} | Rate: ${Math.round(rowRate).toLocaleString()}/s | ETA: ${eta}m`);
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

  // Setup MV
  log('Setting up live sync...');
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
