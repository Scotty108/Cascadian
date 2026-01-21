#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v2 - Working Version (v3)
 *
 * Fixes:
 * 1. Uses renamed columns with _ prefix to avoid ClickHouse aggregate alias issues
 * 2. Uses GROUP BY fill_id for deduplication (memory efficient vs FINAL)
 * 3. Batches condition_ids to avoid query size limits
 *
 * Run: npx tsx scripts/build-trade-fifo-v3.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const START_MONTH = process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '2022-11';
const END_MONTH = process.argv.find(a => a.startsWith('--end='))?.split('=')[1] || '2026-02';
const BATCH_SIZE = 100; // Condition IDs per batch (reduced to avoid memory issues)

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

async function processConditionBatch(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  // Full FIFO query with renamed columns to avoid aggregate alias issues
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
      tokens_sold_early,
      tokens_held,
      exit_value,
      exit_value - cost_usd as pnl_usd,
      CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
      CASE
        WHEN (total_tokens_sold + tokens_held) > 0 THEN
          tokens_sold_early / (total_tokens_sold + tokens_held) * 100
        ELSE 0
      END as pct_sold_early,
      is_maker_flag as is_maker,
      resolved_at
    FROM (
      SELECT
        buy.*,
        coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
        coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) as cumsum_before,
        CASE
          WHEN buy.payout_numerators = '[1,1]' THEN 0.5
          WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
          WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
          ELSE 0.0
        END as payout_rate,
        least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0))) as tokens_sold_early,
        buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0))) as tokens_held,
        (CASE
          WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
            (least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
              ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0))) / coalesce(sells.total_tokens_sold, 0)) * coalesce(sells.total_sell_proceeds, 0)
          ELSE 0
        END) +
        ((buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)))) *
        CASE
          WHEN buy.payout_numerators = '[1,1]' THEN 0.5
          WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
          WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
          ELSE 0.0
        END) as exit_value
      FROM (
        -- Buy trades: aggregate fills into trades by tx_hash
        -- Use renamed columns to avoid aggregate alias issues
        SELECT
          _tx_hash as tx_hash,
          _wallet as wallet,
          _condition_id as condition_id,
          _outcome_index as outcome_index,
          min(_event_time) as entry_time,
          sum(_tokens_delta) as tokens,
          sum(abs(_usdc_delta)) as cost_usd,
          max(_is_maker) as is_maker_flag,
          any(_payout_numerators) as payout_numerators,
          any(_resolved_at) as resolved_at
        FROM (
          -- Dedupe fills by fill_id (avoids memory-heavy FINAL)
          SELECT
            fill_id,
            any(tx_hash) as _tx_hash,
            any(event_time) as _event_time,
            any(wallet) as _wallet,
            any(condition_id) as _condition_id,
            any(outcome_index) as _outcome_index,
            any(tokens_delta) as _tokens_delta,
            any(usdc_delta) as _usdc_delta,
            any(is_maker) as _is_maker,
            any(is_self_fill) as _is_self_fill,
            any(source) as _source,
            any(r.payout_numerators) as _payout_numerators,
            any(r.resolved_at) as _resolved_at
          FROM pm_canonical_fills_v4 f
          INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          WHERE f.condition_id IN (${conditionList})
            AND r.is_deleted = 0 AND r.payout_numerators != ''
          GROUP BY fill_id
        )
        WHERE _source = 'clob'
          AND _tokens_delta > 0
          AND _wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (_is_self_fill = 1 AND _is_maker = 1)
        GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
        HAVING cost_usd >= 0.01
      ) AS buy
      LEFT JOIN (
        -- Sells aggregated by wallet/condition/outcome (before resolution)
        SELECT
          _wallet as wallet,
          _condition_id as condition_id,
          _outcome_index as outcome_index,
          sum(abs(_tokens_delta)) as total_tokens_sold,
          sum(abs(_usdc_delta)) as total_sell_proceeds
        FROM (
          SELECT
            fill_id,
            any(event_time) as _event_time,
            any(wallet) as _wallet,
            any(condition_id) as _condition_id,
            any(outcome_index) as _outcome_index,
            any(tokens_delta) as _tokens_delta,
            any(usdc_delta) as _usdc_delta,
            any(source) as _source,
            any(r.resolved_at) as _resolved_at
          FROM pm_canonical_fills_v4 f
          INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          WHERE f.condition_id IN (${conditionList})
            AND r.is_deleted = 0 AND r.payout_numerators != ''
          GROUP BY fill_id
        )
        WHERE _source = 'clob'
          AND _tokens_delta < 0
          AND _wallet != '0x0000000000000000000000000000000000000000'
          AND _event_time < _resolved_at
        GROUP BY _wallet, _condition_id, _outcome_index
      ) AS sells ON buy.wallet = sells.wallet
        AND buy.condition_id = sells.condition_id
        AND buy.outcome_index = sells.outcome_index
    ) AS fifo
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
    const count = await processConditionBatch(batch);
    totalTrades += count;

    // Progress within month for busy months
    if (batches > 5 && (i + 1) % 5 === 0) {
      process.stdout.write(`(${i + 1}/${batches}) `);
    }
  }

  return { trades: totalTrades, batches };
}

async function main() {
  const startTime = Date.now();
  console.log('=== BUILD pm_trade_fifo_roi_v2 (v3) ===');
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
