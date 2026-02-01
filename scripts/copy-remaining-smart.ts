#!/usr/bin/env npx tsx
/**
 * Smart Copy Remaining Data
 *
 * Copy data month-by-month, checking counts first to identify gaps
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function copyRemainingSmart() {
  console.log('🔄 Smart Copy - Identifying and Filling Gaps\n');

  // Get monthly counts from both tables
  const oldCountsResult = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(resolved_at) as month,
        count() as row_count
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  });
  const oldCounts = await oldCountsResult.json<{ month: string; row_count: string }>();

  const newCountsResult = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(resolved_at) as month,
        count() as row_count
      FROM pm_trade_fifo_roi_v3_mat_unified_v2
      WHERE resolved_at IS NOT NULL
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  });
  const newCounts = await newCountsResult.json<{ month: string; row_count: string }>();

  // Create lookup for new counts
  const newCountMap = new Map(newCounts.map(c => [c.month, parseInt(c.row_count)]));

  console.log('📊 Gap Analysis:\n');
  let totalGap = 0;
  const monthsToFix = [];

  for (const oldMonth of oldCounts) {
    const month = oldMonth.month;
    const oldCount = parseInt(oldMonth.row_count);
    const newCount = newCountMap.get(month) || 0;
    const gap = oldCount - newCount;

    if (gap > 0) {
      console.log(`   ${month.slice(0, 7)}: Missing ${gap.toLocaleString()} / ${oldCount.toLocaleString()} rows (${((gap/oldCount)*100).toFixed(1)}%)`);
      totalGap += gap;
      monthsToFix.push({ month, gap, oldCount });
    }
  }

  console.log(`\n📌 Total gap: ${totalGap.toLocaleString()} rows across ${monthsToFix.length} months\n`);

  if (monthsToFix.length === 0) {
    console.log('✅ No gaps found! Tables are in sync.');
    return;
  }

  console.log(`🔧 Fixing ${monthsToFix.length} months...\n`);
  const startTime = Date.now();

  for (let i = 0; i < monthsToFix.length; i++) {
    const { month, gap } = monthsToFix[i];
    const monthStart = month;
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const monthEndStr = monthEnd.toISOString().slice(0, 19).replace('T', ' ');

    console.log(`   [${i+1}/${monthsToFix.length}] ${monthStart.slice(0, 7)}: Copying ${gap.toLocaleString()} rows...`);

    // Copy month's data with inline deduplication
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified_v2 (
          tx_hash, wallet, condition_id, outcome_index,
          entry_time, resolved_at, tokens, cost_usd,
          tokens_sold_early, tokens_held, exit_value, pnl_usd, roi,
          pct_sold_early, is_maker, is_closed, is_short
        )
        SELECT
          tx_hash,
          wallet,
          condition_id,
          outcome_index,
          any(entry_time) as entry_time,
          any(resolved_at) as resolved_at,
          any(tokens) as tokens,
          any(cost_usd) as cost_usd,
          any(tokens_sold_early) as tokens_sold_early,
          any(tokens_held) as tokens_held,
          any(exit_value) as exit_value,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(pct_sold_early) as pct_sold_early,
          any(is_maker) as is_maker,
          any(is_closed) as is_closed,
          any(is_short) as is_short
        FROM (
          SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
          WHERE resolved_at >= '${monthStart}'
            AND resolved_at < '${monthEndStr}'

          UNION ALL

          SELECT * FROM pm_trade_fifo_roi_v3_mat_unified_v2
          WHERE resolved_at >= '${monthStart}'
            AND resolved_at < '${monthEndStr}'
        )
        GROUP BY tx_hash, wallet, condition_id, outcome_index
      `,
      clickhouse_settings: {
        max_execution_time: 600, // 10 minutes per month
      }
    });

    if ((i + 1) % 5 === 0) {
      const current = await clickhouse.query({
        query: 'SELECT count() as c FROM pm_trade_fifo_roi_v3_mat_unified_v2',
        format: 'JSONEachRow'
      });
      const count = (await current.json<any>())[0].c;
      console.log(`      Progress: ${parseInt(count).toLocaleString()} rows total\n`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Gap filling complete! (${elapsed} minutes)\n`);

  // Final verification
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
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
  console.log(`   Resolved rows: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unique wallets: ${parseInt(final.wallets).toLocaleString()}`);
  console.log(`   Newest resolved: ${final.newest_resolved}`);
  console.log(`   Staleness: ${final.stale_min} minutes\n`);
}

copyRemainingSmart().catch(console.error);
