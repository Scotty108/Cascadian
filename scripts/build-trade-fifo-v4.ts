#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v3 - WITH SHORT POSITIONS (v4)
 *
 * CRITICAL FIX: v3 only tracked LONG positions (tokens_delta > 0).
 * This version also tracks SHORT positions (net_tokens < 0) which occur when
 * someone sells tokens they don't own. If that outcome WINS, they lose money.
 *
 * Example: Sell 6000 tokens on outcome 1 at $0.57 = receive $3,420
 *          If outcome 1 wins, owe 6000 * $1 = $6,000
 *          Net loss = $3,420 - $6,000 = -$2,580
 *
 * Changes from v3:
 * 1. Adds SHORT positions (position-level, not trade-level)
 * 2. Uses new table pm_trade_fifo_roi_v3 with is_short column
 * 3. Shorts use synthetic tx_hash: 'short_' + wallet + condition_id + outcome
 *
 * Run: npx tsx scripts/build-trade-fifo-v4.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const START_MONTH = process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '2022-11';
const END_MONTH = process.argv.find(a => a.startsWith('--end='))?.split('=')[1] || '2026-02';
const BATCH_SIZE = 100;

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

async function processConditionBatchLongs(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  // LONG positions (same as v3, but insert into v3 table with is_short=0)
  const query = `
    INSERT INTO pm_trade_fifo_roi_v3
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
      resolved_at,
      0 as is_short
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

  return 0; // Count done at end
}

async function processConditionBatchShorts(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  // SHORT positions: positions where net_tokens < 0 (sold more than bought)
  // These are position-level, not trade-level
  const query = `
    INSERT INTO pm_trade_fifo_roi_v3
    SELECT
      -- Synthetic tx_hash for shorts
      concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
      wallet,
      condition_id,
      outcome_index,
      entry_time,
      abs(net_tokens) as tokens,  -- Store as positive for display
      -cash_flow as cost_usd,     -- Premium received (stored as positive cost)
      0 as tokens_sold_early,     -- N/A for shorts
      abs(net_tokens) as tokens_held,  -- The short exposure
      -- Exit value: if outcome wins, owe tokens * $1; if loses, $0
      -- For shorts: settlement = net_tokens * payout_rate (negative * positive = negative liability)
      CASE
        WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
        WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
        WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
        ELSE 0.0
      END as exit_value,
      -- PnL = cash_flow + settlement
      -- cash_flow is positive (received premium), settlement is negative if outcome wins
      cash_flow + CASE
        WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
        WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
        WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
        ELSE 0.0
      END as pnl_usd,
      -- ROI: pnl / premium_received
      CASE
        WHEN cash_flow > 0 THEN
          (cash_flow + CASE
            WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
            WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
            WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
            ELSE 0.0
          END) / cash_flow
        ELSE 0
      END as roi,
      0 as pct_sold_early,
      0 as is_maker,  -- Mixed for shorts
      resolved_at,
      1 as is_short
    FROM (
      SELECT
        wallet,
        condition_id,
        outcome_index,
        min(event_time) as entry_time,
        sum(tokens_delta) as net_tokens,
        sum(usdc_delta) as cash_flow,
        any(_payout_numerators) as payout_numerators,
        any(_resolved_at) as resolved_at
      FROM (
        SELECT
          fill_id,
          any(event_time) as event_time,
          any(wallet) as wallet,
          any(condition_id) as condition_id,
          any(outcome_index) as outcome_index,
          any(tokens_delta) as tokens_delta,
          any(usdc_delta) as usdc_delta,
          any(source) as source,
          any(is_self_fill) as is_self_fill,
          any(is_maker) as is_maker,
          any(r.payout_numerators) as _payout_numerators,
          any(r.resolved_at) as _resolved_at
        FROM pm_canonical_fills_v4 f
        INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        WHERE f.condition_id IN (${conditionList})
          AND r.is_deleted = 0 AND r.payout_numerators != ''
        GROUP BY fill_id
      )
      WHERE source = 'clob'
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND NOT (is_self_fill = 1 AND is_maker = 1)
      GROUP BY wallet, condition_id, outcome_index
      HAVING net_tokens < -0.01  -- SHORT position (sold more than bought)
        AND cash_flow > 0.01     -- Received meaningful premium
    )
  `;

  await clickhouse.command({
    query,
    clickhouse_settings: { max_execution_time: 600 }
  });

  return 0;
}

async function processMonth(partition: string): Promise<{ longs: number; shorts: number; batches: number }> {
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
    return { longs: 0, shorts: 0, batches: 0 };
  }

  const batches = Math.ceil(conditions.length / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    const batch = conditions.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    await processConditionBatchLongs(batch);
    await processConditionBatchShorts(batch);

    if (batches > 5 && (i + 1) % 5 === 0) {
      process.stdout.write(`(${i + 1}/${batches}) `);
    }
  }

  // Count results for this month
  const countResult = await clickhouse.query({
    query: `
      SELECT
        countIf(is_short = 0) as longs,
        countIf(is_short = 1) as shorts
      FROM pm_trade_fifo_roi_v3
      WHERE toYYYYMM(resolved_at) = ${partition}
    `,
    format: 'JSONEachRow'
  });
  const counts = ((await countResult.json()) as any[])[0] || { longs: 0, shorts: 0 };

  return { longs: Number(counts.longs), shorts: Number(counts.shorts), batches };
}

async function main() {
  const startTime = Date.now();
  console.log('=== BUILD pm_trade_fifo_roi_v3 (v4 - WITH SHORTS) ===');
  console.log(`Range: ${START_MONTH} to ${END_MONTH}`);
  console.log(`Batch size: ${BATCH_SIZE} conditions per batch`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  const months = generateMonths(START_MONTH, END_MONTH);
  console.log(`Processing ${months.length} months...\n`);

  // Create new table with is_short column
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_trade_fifo_roi_v3 (
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
        resolved_at DateTime,
        is_short UInt8 DEFAULT 0
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      PARTITION BY toYYYYMM(resolved_at)
    `
  });

  let totalLongs = 0;
  let totalShorts = 0;
  let totalBatches = 0;
  let errors = 0;

  for (let i = 0; i < months.length; i++) {
    const partition = months[i];
    const monthStart = Date.now();

    process.stdout.write(`[${i + 1}/${months.length}] ${partition}... `);

    try {
      const result = await processMonth(partition);
      totalLongs += result.longs;
      totalShorts += result.shorts;
      totalBatches += result.batches;
      const elapsed = ((Date.now() - monthStart) / 1000).toFixed(1);
      console.log(`${result.longs.toLocaleString()} longs + ${result.shorts.toLocaleString()} shorts (${result.batches} batches, ${elapsed}s)`);
    } catch (err: any) {
      errors++;
      console.log(`ERROR: ${err.message.slice(0, 100)}`);
    }

    if ((i + 1) % 5 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const remaining = months.length - i - 1;
      const eta = Math.round(remaining / rate / 60);
      console.log(`   → Progress: ${Math.round((i + 1) / months.length * 100)}% | Longs: ${totalLongs.toLocaleString()} | Shorts: ${totalShorts.toLocaleString()} | ETA: ${eta}m\n`);
    }
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log('\n=== COMPLETE ===');
  console.log(`Total longs: ${totalLongs.toLocaleString()}`);
  console.log(`Total shorts: ${totalShorts.toLocaleString()}`);
  console.log(`Total positions: ${(totalLongs + totalShorts).toLocaleString()}`);
  console.log(`Total batches: ${totalBatches}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);

  // Final stats
  const stats = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        countIf(is_short = 0) as longs,
        countIf(is_short = 1) as shorts,
        count(DISTINCT wallet) as unique_wallets,
        countIf(pnl_usd > 0) as winners,
        countIf(pnl_usd <= 0) as losers,
        round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,
        round(sum(pnl_usd), 2) as total_pnl,
        round(sumIf(pnl_usd, is_short = 0), 2) as long_pnl,
        round(sumIf(pnl_usd, is_short = 1), 2) as short_pnl
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow'
  });
  const s = ((await stats.json()) as any[])[0];
  console.log('\n📊 Final Stats:');
  console.log(`   Total Positions: ${s.total_positions?.toLocaleString()}`);
  console.log(`   Longs: ${s.longs?.toLocaleString()}`);
  console.log(`   Shorts: ${s.shorts?.toLocaleString()}`);
  console.log(`   Wallets: ${s.unique_wallets?.toLocaleString()}`);
  console.log(`   Winners: ${s.winners?.toLocaleString()} (${s.win_rate_pct}%)`);
  console.log(`   Losers: ${s.losers?.toLocaleString()}`);
  console.log(`   Total PnL: $${s.total_pnl?.toLocaleString()}`);
  console.log(`   Long PnL: $${s.long_pnl?.toLocaleString()}`);
  console.log(`   Short PnL: $${s.short_pnl?.toLocaleString()}`);
}

main().catch(e => {
  console.error('❌ Fatal error:', e.message);
  process.exit(1);
});
