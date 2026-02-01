#!/usr/bin/env npx tsx
/**
 * Copy Remaining Resolved Rows in Date Chunks
 *
 * Copies remaining historical data in monthly chunks to avoid memory limits
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function copyRemainingChunked() {
  console.log('🔄 Copying Remaining Historical Data (Chunked)\n');

  // Get date ranges that need copying
  const rangesResult = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(resolved_at) as month,
        count() as rows_in_old
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  });
  const ranges = await rangesResult.json<{ month: string; rows_in_old: string }>();

  console.log(`Found ${ranges.length} monthly chunks to process\n`);

  let totalCopied = 0;
  const startTime = Date.now();

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const monthStart = range.month;
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const monthEndStr = monthEnd.toISOString().slice(0, 19).replace('T', ' ');

    console.log(`Month ${i + 1}/${ranges.length}: ${monthStart.slice(0, 7)} (${parseInt(range.rows_in_old).toLocaleString()} rows in old)`);

    // Copy this month's data
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified_v2
        SELECT old.*
        FROM pm_trade_fifo_roi_v3_mat_unified AS old
        LEFT JOIN pm_trade_fifo_roi_v3_mat_unified_v2 AS new
          ON old.tx_hash = new.tx_hash
          AND old.wallet = new.wallet
          AND old.condition_id = new.condition_id
          AND old.outcome_index = new.outcome_index
        WHERE old.resolved_at >= '${monthStart}'
          AND old.resolved_at < '${monthEndStr}'
          AND new.tx_hash = ''
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });

    if ((i + 1) % 5 === 0 || i === ranges.length - 1) {
      const current = await clickhouse.query({
        query: 'SELECT count() as c FROM pm_trade_fifo_roi_v3_mat_unified_v2',
        format: 'JSONEachRow'
      });
      const count = (await current.json<any>())[0].c;
      console.log(`   Progress: ${parseInt(count).toLocaleString()} rows total\n`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Historical copy complete! (${elapsed} minutes)\n`);

  // Final verification
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as stale_min,
        uniq(wallet) as wallets
      FROM pm_trade_fifo_roi_v3_mat_unified_v2
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];

  console.log('📊 FINAL TABLE:');
  console.log(`   Total rows: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Unique wallets: ${parseInt(final.wallets).toLocaleString()}`);
  console.log(`   Newest resolved: ${final.newest_resolved}`);
  console.log(`   Staleness: ${final.stale_min} minutes\n`);
}

copyRemainingChunked().catch(console.error);
