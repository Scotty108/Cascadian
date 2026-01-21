#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v2 - SIMPLE VERSION
 *
 * Uses FINAL with partition filtering for each month
 * Simpler query structure to avoid CTE issues
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
  // Step 1: Get resolutions for this month
  const resolutions = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND toYYYYMM(resolved_at) = ${partition}
    `,
    format: 'JSONEachRow'
  });
  const resolutionRows = await resolutions.json() as { condition_id: string; payout_numerators: string; resolved_at: string }[];

  if (resolutionRows.length === 0) {
    return 0;
  }

  // Step 2: Insert FIFO trades for resolved conditions
  const conditionIds = resolutionRows.map(r => `'${r.condition_id}'`).join(',');

  const query = `
    INSERT INTO pm_trade_fifo_roi_v2
    WITH
    buy_trades AS (
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        min(event_time) as entry_time,
        sum(tokens_delta) as tokens,
        sum(abs(usdc_delta)) as cost_usd,
        any(is_maker) as is_maker
      FROM pm_canonical_fills_v4 FINAL
      WHERE source = 'clob'
        AND condition_id IN (${conditionIds})
        AND tokens_delta > 0
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND NOT (is_self_fill = 1 AND is_maker = 1)
      GROUP BY tx_hash, wallet, condition_id, outcome_index
      HAVING cost_usd >= 0.01
    ),
    sells_agg AS (
      SELECT
        wallet, condition_id, outcome_index,
        sum(abs(tokens_delta)) as total_tokens_sold,
        sum(abs(usdc_delta)) as total_sell_proceeds
      FROM pm_canonical_fills_v4 FINAL
      WHERE source = 'clob'
        AND condition_id IN (${conditionIds})
        AND tokens_delta < 0
        AND wallet != '0x0000000000000000000000000000000000000000'
      GROUP BY wallet, condition_id, outcome_index
    ),
    fifo_calc AS (
      SELECT
        b.tx_hash,
        b.wallet,
        b.condition_id,
        b.outcome_index,
        b.entry_time,
        b.tokens,
        b.cost_usd,
        b.is_maker,
        coalesce(s.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(s.total_sell_proceeds, 0) as total_sell_proceeds,
        coalesce(sum(b.tokens) OVER (
          PARTITION BY b.wallet, b.condition_id, b.outcome_index
          ORDER BY b.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) as cumsum_before
      FROM buy_trades b
      LEFT JOIN sells_agg s ON b.wallet = s.wallet
        AND b.condition_id = s.condition_id
        AND b.outcome_index = s.outcome_index
    ),
    with_resolution AS (
      SELECT
        f.*,
        r.payout_numerators,
        r.resolved_at,
        CASE
          WHEN r.payout_numerators = '[1,1]' THEN 0.5
          WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
          WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
          ELSE 0.0
        END as payout_rate
      FROM fifo_calc f
      INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      WHERE r.is_deleted = 0 AND r.payout_numerators != ''
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
        WHEN total_tokens_sold > 0 THEN total_tokens_sold / greatest(1, total_tokens_sold + tokens - least(tokens, greatest(0, total_tokens_sold - cumsum_before))) * 100
        ELSE 0
      END as pct_sold_early,
      is_maker,
      resolved_at
    FROM with_resolution
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
  console.log('=== BUILD pm_trade_fifo_roi_v2 (Simple Version) ===');
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
