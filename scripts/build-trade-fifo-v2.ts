#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v2 - Working Version
 *
 * Fixes:
 * 1. Uses nested subqueries instead of CTEs to avoid aggregate alias issues
 * 2. Batches condition_ids to avoid query size limits
 * 3. Uses FINAL with partition filtering for deduplication
 *
 * Run: npx tsx scripts/build-trade-fifo-v2.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const START_MONTH = process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '2022-11';
const END_MONTH = process.argv.find(a => a.startsWith('--end='))?.split('=')[1] || '2026-02';
const BATCH_SIZE = 200; // Condition IDs per batch

function generateMonths(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  let [year, month] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    months.push(`${year}${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}

async function processConditionBatch(conditionIds: string[], resolvedAtPartition: string): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  // Use nested subqueries instead of CTEs to avoid aggregate alias issues
  const query = `
    INSERT INTO pm_trade_fifo_roi_v2
    SELECT
      tx_hash,
      wallet,
      condition_id,
      outcome_index,
      entry_time,
      tokens,
      cost_usd,
      -- tokens_sold_early: how much of this buy was sold before resolution (FIFO)
      least(tokens, greatest(0, total_tokens_sold - cumsum_before)) as tokens_sold_early,
      -- tokens_held: remaining tokens held to resolution
      tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before)) as tokens_held,
      -- exit_value: early sell proceeds + resolution payout
      (CASE
        WHEN total_tokens_sold > 0 THEN
          (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
        ELSE 0
      END) +
      ((tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate) as exit_value,
      -- pnl_usd
      ((CASE
        WHEN total_tokens_sold > 0 THEN
          (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
        ELSE 0
      END) +
      ((tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate)) - cost_usd as pnl_usd,
      -- roi
      CASE
        WHEN cost_usd > 0 THEN
          (((CASE
            WHEN total_tokens_sold > 0 THEN
              (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
            ELSE 0
          END) +
          ((tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate)) - cost_usd) / cost_usd
        ELSE 0
      END as roi,
      -- pct_sold_early
      CASE
        WHEN (total_tokens_sold + tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) > 0 THEN
          (total_tokens_sold / (total_tokens_sold + tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before)))) * 100
        ELSE 0
      END as pct_sold_early,
      is_maker,
      resolved_at
    FROM (
      -- Add FIFO calculation: cumulative sum of buys before this one
      SELECT
        buy.*,
        coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
        coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) as cumsum_before,
        -- Calculate payout rate
        CASE
          WHEN buy.payout_numerators = '[1,1]' THEN 0.5
          WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
          WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
          ELSE 0.0
        END as payout_rate
      FROM (
        -- Buy trades: aggregate fills into trades by tx_hash
        SELECT
          f.tx_hash,
          f.wallet,
          f.condition_id,
          f.outcome_index,
          min(f.event_time) as entry_time,
          sum(f.tokens_delta) as tokens,
          sum(abs(f.usdc_delta)) as cost_usd,
          max(f.is_maker) as is_maker,
          r.payout_numerators,
          r.resolved_at
        FROM pm_canonical_fills_v4 FINAL f
        INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        WHERE f.source = 'clob'
          AND f.condition_id IN (${conditionList})
          AND f.tokens_delta > 0
          AND f.wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        GROUP BY f.tx_hash, f.wallet, f.condition_id, f.outcome_index, r.payout_numerators, r.resolved_at
        HAVING cost_usd >= 0.01
      ) buy
      LEFT JOIN (
        -- Sells aggregated by wallet/condition/outcome (total sells before resolution)
        SELECT
          f.wallet,
          f.condition_id,
          f.outcome_index,
          sum(abs(f.tokens_delta)) as total_tokens_sold,
          sum(abs(f.usdc_delta)) as total_sell_proceeds
        FROM pm_canonical_fills_v4 FINAL f
        INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        WHERE f.source = 'clob'
          AND f.condition_id IN (${conditionList})
          AND f.tokens_delta < 0
          AND f.wallet != '0x0000000000000000000000000000000000000000'
          AND f.event_time < r.resolved_at
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        GROUP BY f.wallet, f.condition_id, f.outcome_index
      ) sells ON buy.wallet = sells.wallet
        AND buy.condition_id = sells.condition_id
        AND buy.outcome_index = sells.outcome_index
    )
  `;

  await clickhouse.command({
    query,
    clickhouse_settings: { max_execution_time: 600 }
  });

  // Count inserted rows for this batch
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trade_fifo_roi_v2
      WHERE condition_id IN (${conditionList})
    `,
    format: 'JSONEachRow'
  });
  return ((await countResult.json()) as any[])[0]?.cnt || 0;
}

async function processMonth(partition: string): Promise<{ trades: number; batches: number }> {
  // Step 1: Get all resolved conditions for this month
  const resolutions = await clickhouse.query({
    query: `
      SELECT condition_id
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND toYYYYMM(resolved_at) = ${partition}
    `,
    format: 'JSONEachRow'
  });
  const conditions = (await resolutions.json() as { condition_id: string }[]).map(r => r.condition_id);

  if (conditions.length === 0) {
    return { trades: 0, batches: 0 };
  }

  // Step 2: Process in batches to avoid query size limits
  let totalTrades = 0;
  const batches = Math.ceil(conditions.length / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    const batch = conditions.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const count = await processConditionBatch(batch, partition);
    totalTrades += count;
  }

  return { trades: totalTrades, batches };
}

async function main() {
  const startTime = Date.now();
  console.log('=== BUILD pm_trade_fifo_roi_v2 (v2) ===');
  console.log(`Range: ${START_MONTH} to ${END_MONTH}`);
  console.log(`Batch size: ${BATCH_SIZE} conditions per batch`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  const months = generateMonths(START_MONTH, END_MONTH);
  console.log(`Processing ${months.length} months...\n`);

  // Ensure table exists
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_trade_fifo_roi_v2 (
        tx_hash String,
        wallet LowCardinality(String),
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        tokens Float64,
        cost_usd Float64,
        tokens_sold_early Float64,
        tokens_held Float64,
        exit_value Float64,
        pnl_usd Float64,
        roi Float64,
        pct_sold_early Float64,
        is_maker UInt8,
        resolved_at DateTime
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      PARTITION BY toYYYYMM(resolved_at)
    `
  });

  let totalTrades = 0;
  let totalBatches = 0;
  let errors = 0;

  for (let i = 0; i < months.length; i++) {
    const partition = months[i];
    const monthStart = Date.now();

    process.stdout.write(`[${i + 1}/${months.length}] ${partition}... `);

    try {
      const result = await processMonth(partition);
      totalTrades += result.trades;
      totalBatches += result.batches;
      const elapsed = ((Date.now() - monthStart) / 1000).toFixed(1);
      console.log(`${result.trades.toLocaleString()} trades (${result.batches} batches, ${elapsed}s) | Total: ${totalTrades.toLocaleString()}`);
    } catch (err: any) {
      errors++;
      console.log(`ERROR: ${err.message.slice(0, 100)}`);
    }

    // Progress every 5 months
    if ((i + 1) % 5 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const remaining = months.length - i - 1;
      const eta = Math.round(remaining / rate / 60);
      console.log(`   → Progress: ${Math.round((i + 1) / months.length * 100)}% | ETA: ${eta}m\n`);
    }
  }

  // Final stats
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log('\n=== COMPLETE ===');
  console.log(`Total trades: ${totalTrades.toLocaleString()}`);
  console.log(`Total batches: ${totalBatches}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);

  // Table stats
  const stats = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        count(DISTINCT wallet) as unique_wallets,
        countIf(roi > 0) as winners,
        countIf(roi <= 0) as losers,
        round(avg(roi) * 100, 2) as avg_roi_pct,
        round(sum(pnl_usd), 2) as total_pnl
      FROM pm_trade_fifo_roi_v2
    `,
    format: 'JSONEachRow'
  });
  const s = ((await stats.json()) as any[])[0];
  console.log('\n📊 Final Stats:');
  console.log(`   Trades: ${s.total_trades?.toLocaleString()}`);
  console.log(`   Wallets: ${s.unique_wallets?.toLocaleString()}`);
  console.log(`   Winners: ${s.winners?.toLocaleString()} (${Math.round(s.winners / s.total_trades * 100)}%)`);
  console.log(`   Avg ROI: ${s.avg_roi_pct}%`);
  console.log(`   Total PnL: $${s.total_pnl?.toLocaleString()}`);
}

main().catch(e => {
  console.error('❌ Fatal error:', e.message);
  process.exit(1);
});
