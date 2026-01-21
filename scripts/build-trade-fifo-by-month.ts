#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v2 - BY MONTH with partition filtering
 *
 * Uses GROUP BY for deduplication (cheaper than FINAL on full table)
 * Processes by month to limit memory usage
 *
 * Run: npx tsx scripts/build-trade-fifo-by-month.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const START_MONTH = process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '2022-11';
const END_MONTH = process.argv.find(a => a.startsWith('--end='))?.split('=')[1] || '2026-02';

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

async function processMonth(partition: string): Promise<number> {
  // Convert partition YYYYMM to date range
  const year = partition.slice(0, 4);
  const month = partition.slice(4, 6);
  const startDate = `${year}-${month}-01`;
  const nextMonth = parseInt(month) === 12 ? '01' : String(parseInt(month) + 1).padStart(2, '0');
  const nextYear = parseInt(month) === 12 ? String(parseInt(year) + 1) : year;
  const endDate = `${nextYear}-${nextMonth}-01`;

  // FIFO calculation using GROUP BY for deduplication (more memory efficient than FINAL)
  const query = `
    INSERT INTO pm_trade_fifo_roi_v2
    WITH
    -- Deduplicated fills using GROUP BY (cheaper than FINAL on large table)
    fills_deduped AS (
      SELECT
        fill_id,
        any(event_time) as fill_time,
        any(tx_hash) as tx_hash,
        any(wallet) as wallet,
        any(condition_id) as condition_id,
        any(outcome_index) as outcome_index,
        any(tokens_delta) as tokens_delta,
        any(usdc_delta) as usdc_delta,
        any(is_maker) as is_maker
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND toYYYYMM(event_time) = ${partition}
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND NOT (is_self_fill = 1 AND is_maker = 1)
      GROUP BY fill_id
    ),

    -- Resolutions for this month
    resolutions AS (
      SELECT condition_id, payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND toYYYYMM(resolved_at) = ${partition}
    ),

    -- Buy trades aggregated by tx_hash
    buy_trades AS (
      SELECT
        f.tx_hash,
        f.wallet,
        f.condition_id,
        f.outcome_index,
        min(f.fill_time) as entry_time,
        sum(f.tokens_delta) as tokens,
        sum(abs(f.usdc_delta)) as cost_usd,
        any(f.is_maker) as is_maker,
        any(r.payout_numerators) as payout_numerators,
        any(r.resolved_at) as resolved_at
      FROM fills_deduped f
      INNER JOIN resolutions r ON f.condition_id = r.condition_id
      WHERE f.tokens_delta > 0
      GROUP BY f.tx_hash, f.wallet, f.condition_id, f.outcome_index
      HAVING cost_usd >= 0.01
    ),

    -- Total sells per position (before resolution)
    sells_agg AS (
      SELECT
        f.wallet, f.condition_id, f.outcome_index,
        sum(abs(f.tokens_delta)) as total_tokens_sold,
        sum(abs(f.usdc_delta)) as total_sell_proceeds
      FROM fills_deduped f
      INNER JOIN resolutions r ON f.condition_id = r.condition_id
      WHERE f.tokens_delta < 0
        AND f.fill_time < r.resolved_at
      GROUP BY f.wallet, f.condition_id, f.outcome_index
    ),

    -- FIFO calculation
    fifo_calc AS (
      SELECT
        b.*,
        coalesce(s.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(s.total_sell_proceeds, 0) as total_sell_proceeds,
        coalesce(sum(b.tokens) OVER (
          PARTITION BY b.wallet, b.condition_id, b.outcome_index
          ORDER BY b.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) as cumsum_before,
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
      least(tokens, greatest(0, total_tokens_sold - cumsum_before)) as tokens_sold_early,
      tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before)) as tokens_held,
      CASE
        WHEN total_tokens_sold > 0 THEN
          (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
        ELSE 0
      END +
      (tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate as exit_value,
      (CASE
        WHEN total_tokens_sold > 0 THEN
          (least(tokens, greatest(0, total_tokens_sold - cumsum_before)) / total_tokens_sold) * total_sell_proceeds
        ELSE 0
      END +
      (tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * payout_rate) - cost_usd as pnl_usd,
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
      CASE
        WHEN total_tokens_sold > 0 THEN total_tokens_sold / (total_tokens_sold + (tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before)))) * 100
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
    query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v2 WHERE toYYYYMM(resolved_at) = ${partition}`,
    format: 'JSONEachRow'
  });
  return ((await countResult.json()) as any[])[0]?.cnt || 0;
}

async function main() {
  const startTime = Date.now();
  console.log('=== BUILD pm_trade_fifo_roi_v2 (By Month) ===');
  console.log(`Range: ${START_MONTH} to ${END_MONTH}`);
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
  let errors = 0;

  for (let i = 0; i < months.length; i++) {
    const partition = months[i];
    const monthStart = Date.now();

    process.stdout.write(`[${i + 1}/${months.length}] ${partition}... `);

    try {
      const count = await processMonth(partition);
      totalTrades += count;
      const elapsed = ((Date.now() - monthStart) / 1000).toFixed(1);
      console.log(`${count.toLocaleString()} trades (${elapsed}s) | Total: ${totalTrades.toLocaleString()}`);
    } catch (err: any) {
      errors++;
      console.log(`ERROR: ${err.message.slice(0, 80)}`);
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
