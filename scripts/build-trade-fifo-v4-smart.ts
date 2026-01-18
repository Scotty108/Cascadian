#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v3 - SMART VERSION
 * Only processes conditions that ACTUALLY have CLOB fills
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const MONTH = process.argv.find(a => a.startsWith('--month='))?.split('=')[1] || '202601';
const BATCH_SIZE = 50;

async function getConditionsWithFills(partition: string): Promise<string[]> {
  // Get conditions that have fills but aren't in FIFO table yet
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT f.condition_id
      FROM pm_canonical_fills_v4 f
      JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      WHERE f.source = 'clob'
        AND r.is_deleted = 0
        AND r.payout_numerators != ''
        AND toYYYYMM(r.resolved_at) = ${partition}
        AND f.condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3 WHERE toYYYYMM(resolved_at) = ${partition}
        )
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as { condition_id: string }[];
  return rows.map(r => r.condition_id);
}

async function processConditionBatch(conditionIds: string[], isLongs: boolean): Promise<void> {
  if (conditionIds.length === 0) return;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  if (isLongs) {
    const query = `
      INSERT INTO pm_trade_fifo_roi_v3
      SELECT
        tx_hash, wallet, condition_id, outcome_index, entry_time,
        tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
        exit_value - cost_usd as pnl_usd,
        CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
        CASE WHEN (total_tokens_sold + tokens_held) > 0 THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100 ELSE 0 END as pct_sold_early,
        is_maker_flag as is_maker, resolved_at, 0 as is_short
      FROM (
        SELECT buy.*,
          coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
          coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
          CASE
            WHEN buy.payout_numerators = '[1,1]' THEN 0.5
            WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
            WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
            ELSE 0.0
          END as payout_rate,
          least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_sold_early,
          buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_held,
          (CASE WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
            (least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0))) / coalesce(sells.total_tokens_sold, 0)) * coalesce(sells.total_sell_proceeds, 0)
          ELSE 0 END) +
          ((buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0)))) * CASE
            WHEN buy.payout_numerators = '[1,1]' THEN 0.5
            WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
            WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
            ELSE 0.0
          END) as exit_value
        FROM (
          SELECT _tx_hash as tx_hash, _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
            min(_event_time) as entry_time, sum(_tokens_delta) as tokens, sum(abs(_usdc_delta)) as cost_usd,
            max(_is_maker) as is_maker_flag, any(_payout_numerators) as payout_numerators, any(_resolved_at) as resolved_at
          FROM (
            SELECT fill_id, any(tx_hash) as _tx_hash, any(event_time) as _event_time, any(wallet) as _wallet,
              any(condition_id) as _condition_id, any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
              any(usdc_delta) as _usdc_delta, any(is_maker) as _is_maker, any(is_self_fill) as _is_self_fill,
              any(source) as _source, any(r.payout_numerators) as _payout_numerators, any(r.resolved_at) as _resolved_at
            FROM pm_canonical_fills_v4 f
            INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
            WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != ''
            GROUP BY fill_id
          )
          WHERE _source = 'clob' AND _tokens_delta > 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (_is_self_fill = 1 AND _is_maker = 1)
          GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
          HAVING cost_usd >= 0.01
        ) AS buy
        LEFT JOIN (
          SELECT _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
            sum(abs(_tokens_delta)) as total_tokens_sold, sum(abs(_usdc_delta)) as total_sell_proceeds
          FROM (
            SELECT fill_id, any(event_time) as _event_time, any(wallet) as _wallet, any(condition_id) as _condition_id,
              any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta, any(usdc_delta) as _usdc_delta,
              any(source) as _source, any(r.resolved_at) as _resolved_at
            FROM pm_canonical_fills_v4 f
            INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
            WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != ''
            GROUP BY fill_id
          )
          WHERE _source = 'clob' AND _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            AND _event_time < _resolved_at
          GROUP BY _wallet, _condition_id, _outcome_index
        ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
      )
    `;
    await clickhouse.command({ query, clickhouse_settings: { max_execution_time: 600 } });
  } else {
    // SHORTS
    const query = `
      INSERT INTO pm_trade_fifo_roi_v3
      SELECT
        concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
        wallet, condition_id, outcome_index, entry_time,
        abs(net_tokens) as tokens, -cash_flow as cost_usd, 0 as tokens_sold_early, abs(net_tokens) as tokens_held,
        CASE
          WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
          WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
          WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
          ELSE 0.0
        END as exit_value,
        cash_flow + CASE
          WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
          WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
          WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
          ELSE 0.0
        END as pnl_usd,
        CASE WHEN cash_flow > 0 THEN
          (cash_flow + CASE
            WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
            WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
            WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
            ELSE 0.0
          END) / cash_flow
        ELSE 0 END as roi,
        0 as pct_sold_early, 0 as is_maker, resolved_at, 1 as is_short
      FROM (
        SELECT wallet, condition_id, outcome_index, min(event_time) as entry_time,
          sum(tokens_delta) as net_tokens, sum(usdc_delta) as cash_flow,
          any(_payout_numerators) as payout_numerators, any(_resolved_at) as resolved_at
        FROM (
          SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet, any(condition_id) as condition_id,
            any(outcome_index) as outcome_index, any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
            any(source) as source, any(is_self_fill) as is_self_fill, any(is_maker) as is_maker,
            any(r.payout_numerators) as _payout_numerators, any(r.resolved_at) as _resolved_at
          FROM pm_canonical_fills_v4 f
          INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != ''
          GROUP BY fill_id
        )
        WHERE source = 'clob' AND wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (is_self_fill = 1 AND is_maker = 1)
        GROUP BY wallet, condition_id, outcome_index
        HAVING net_tokens < -0.01 AND cash_flow > 0.01
      )
    `;
    await clickhouse.command({ query, clickhouse_settings: { max_execution_time: 600 } });
  }
}

async function main() {
  console.log(`=== FIFO v4 SMART BUILD for ${MONTH} ===`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  console.log('Finding conditions with fills that need processing...');
  const conditions = await getConditionsWithFills(MONTH);
  console.log(`Found ${conditions.length} conditions to process\n`);

  if (conditions.length === 0) {
    console.log('Nothing to process!');
    return;
  }

  const batches = Math.ceil(conditions.length / BATCH_SIZE);
  let errors = 0;

  for (let i = 0; i < batches; i++) {
    const batch = conditions.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);

    try {
      await processConditionBatch(batch, true);  // Longs
      await processConditionBatch(batch, false); // Shorts
    } catch (err: any) {
      errors++;
      console.log(`[${i + 1}/${batches}] Error: ${err.message.slice(0, 50)}`);
    }

    if ((i + 1) % 10 === 0 || i === batches - 1) {
      process.stdout.write(`(${i + 1}/${batches}) `);
    }
  }

  console.log(`\n\n=== COMPLETE ===`);
  console.log(`Processed: ${conditions.length} conditions in ${batches} batches`);
  console.log(`Errors: ${errors}`);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
