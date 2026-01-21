#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v2 - FULL HISTORY
 *
 * Pure SQL FIFO calculation (validated accurate)
 * Processes by week to avoid memory issues
 *
 * Expected runtime: 2-4 hours for full history
 * Expected output: ~70-80M trade-level ROI records
 *
 * Run overnight:
 *   nohup npx tsx scripts/build-trade-fifo-full-history.ts > fifo-build.log 2>&1 &
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const DRY_RUN = process.argv.includes('--dry-run');
const START_DATE = process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '2022-11-01';
const END_DATE = process.argv.find(a => a.startsWith('--end='))?.split('=')[1] || new Date().toISOString().slice(0, 10);

interface WeekRange {
  start: string;
  end: string;
  label: string;
}

function generateWeeks(startDate: string, endDate: string): WeekRange[] {
  const weeks: WeekRange[] = [];
  let current = new Date(startDate);
  const end = new Date(endDate);

  while (current < end) {
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 7);
    if (weekEnd > end) weekEnd.setTime(end.getTime());

    weeks.push({
      start: current.toISOString().slice(0, 10),
      end: weekEnd.toISOString().slice(0, 10),
      label: current.toISOString().slice(0, 10)
    });

    current = weekEnd;
  }
  return weeks;
}

async function processWeek(week: WeekRange): Promise<number> {
  // Pure SQL FIFO calculation (validated accurate)
  const query = `
    INSERT INTO pm_trade_fifo_roi_v2
    WITH
    -- Deduplicated fills for this week's resolved positions
    fills AS (
      SELECT * FROM pm_canonical_fills_v4 FINAL
      WHERE source = 'clob'
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND NOT (is_self_fill = 1 AND is_maker = 1)
    ),

    -- Get buy trades (aggregated by tx_hash)
    buy_trades AS (
      SELECT
        f.tx_hash,
        f.wallet,
        f.condition_id,
        f.outcome_index,
        min(f.event_time) as entry_time,
        sum(f.tokens_delta) as tokens,
        sum(abs(f.usdc_delta)) as cost_usd,
        any(f.is_maker) as is_maker,
        any(r.payout_numerators) as payout_numerators,
        any(r.resolved_at) as resolved_at
      FROM fills f
      INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != ''
      WHERE f.tokens_delta > 0
        AND r.resolved_at >= '${week.start}' AND r.resolved_at < '${week.end}'
      GROUP BY f.tx_hash, f.wallet, f.condition_id, f.outcome_index
      HAVING cost_usd >= 0.01
    ),

    -- Get total sells per position (before resolution)
    sells_agg AS (
      SELECT
        f.wallet, f.condition_id, f.outcome_index,
        sum(abs(f.tokens_delta)) as total_tokens_sold,
        sum(abs(f.usdc_delta)) as total_sell_proceeds
      FROM fills f
      INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != ''
      WHERE f.tokens_delta < 0
        AND f.event_time < r.resolved_at
        AND r.resolved_at >= '${week.start}' AND r.resolved_at < '${week.end}'
      GROUP BY f.wallet, f.condition_id, f.outcome_index
    ),

    -- FIFO calculation
    fifo_calc AS (
      SELECT
        b.*,
        coalesce(s.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(s.total_sell_proceeds, 0) as total_sell_proceeds,
        -- Cumulative sum of buys BEFORE this one (for FIFO)
        coalesce(sum(b.tokens) OVER (
          PARTITION BY b.wallet, b.condition_id, b.outcome_index
          ORDER BY b.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) as cumsum_before,
        -- Payout rate
        CASE
          WHEN b.payout_numerators = '[1,1]' THEN 0.5
          WHEN b.payout_numerators = '[0,1]' AND b.outcome_index = 1 THEN 1.0
          WHEN b.payout_numerators = '[1,0]' AND b.outcome_index = 0 THEN 1.0
          ELSE 0.0
        END as payout_rate
      FROM buy_trades b
      LEFT JOIN sells_agg s ON b.wallet = s.wallet
        AND b.condition_id = s.condition_id
        AND b.outcome_index = s.outcome_index
    )

    SELECT
      tx_hash,
      wallet,
      condition_id,
      outcome_index,
      entry_time,
      tokens,
      cost_usd,
      -- FIFO allocation: how many of THIS buy's tokens were sold early
      least(tokens, greatest(0, total_tokens_sold - cumsum_before)) as tokens_sold_early,
      tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before)) as tokens_held,
      -- Exit value = sold proceeds (pro-rata) + held tokens * payout
      CASE
        WHEN total_tokens_sold > 0 THEN
          (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
        ELSE 0
      END +
      (tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate as exit_value,
      -- PnL
      (CASE
        WHEN total_tokens_sold > 0 THEN
          (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
        ELSE 0
      END +
      (tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate) - cost_usd as pnl_usd,
      -- ROI
      CASE
        WHEN cost_usd > 0 THEN
          ((CASE
            WHEN total_tokens_sold > 0 THEN
              (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
            ELSE 0
          END +
          (tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate) - cost_usd) / cost_usd
        ELSE 0
      END as roi,
      -- Pct sold early for this position
      CASE
        WHEN (SELECT sum(tokens) FROM buy_trades bt WHERE bt.wallet = fifo_calc.wallet AND bt.condition_id = fifo_calc.condition_id AND bt.outcome_index = fifo_calc.outcome_index) > 0 THEN
          total_tokens_sold / (SELECT sum(tokens) FROM buy_trades bt WHERE bt.wallet = fifo_calc.wallet AND bt.condition_id = fifo_calc.condition_id AND bt.outcome_index = fifo_calc.outcome_index) * 100
        ELSE 0
      END as pct_sold_early,
      is_maker,
      resolved_at
    FROM fifo_calc
  `;

  await clickhouse.command({
    query,
    clickhouse_settings: { max_execution_time: 600 }
  });

  // Count inserted rows
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v2 WHERE resolved_at >= '${week.start}' AND resolved_at < '${week.end}'`,
    format: 'JSONEachRow'
  });
  return ((await countResult.json()) as any[])[0]?.cnt || 0;
}

async function main() {
  const startTime = Date.now();
  console.log('=== BUILD pm_trade_fifo_roi_v2 (Full History) ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Range: ${START_DATE} to ${END_DATE}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  const weeks = generateWeeks(START_DATE, END_DATE);
  console.log(`Processing ${weeks.length} weeks...\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Would process:');
    weeks.forEach((w, i) => console.log(`  ${i + 1}. ${w.label} → ${w.end}`));
    console.log(`\nEstimated time: ${Math.round(weeks.length * 2)} minutes`);
    return;
  }

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
  let errors = 0;

  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    const weekStart = Date.now();

    process.stdout.write(`[${i + 1}/${weeks.length}] ${week.label}... `);

    try {
      const count = await processWeek(week);
      totalTrades += count;
      const elapsed = ((Date.now() - weekStart) / 1000).toFixed(1);
      console.log(`${count.toLocaleString()} trades (${elapsed}s) | Total: ${totalTrades.toLocaleString()}`);
    } catch (err: any) {
      errors++;
      console.log(`ERROR: ${err.message.slice(0, 100)}`);
    }

    // Progress update every 10 weeks
    if ((i + 1) % 10 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const remaining = weeks.length - i - 1;
      const eta = Math.round(remaining / rate / 60);
      console.log(`   → Progress: ${Math.round((i + 1) / weeks.length * 100)}% | ETA: ${eta}m\n`);
    }
  }

  // Final stats
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log('\n=== COMPLETE ===');
  console.log(`Total trades: ${totalTrades.toLocaleString()}`);
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
