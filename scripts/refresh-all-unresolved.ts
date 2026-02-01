#!/usr/bin/env npx tsx
/**
 * Refresh ALL unresolved positions in the unified table (SAFE VERSION)
 *
 * Unlike the incremental cron which only updates active wallets,
 * this script refreshes unresolved positions for ALL wallets.
 *
 * SAFETY: Uses anti-join pattern - only inserts rows that don't exist.
 * NEVER deletes data. If script crashes, no data is lost.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const BATCH_SIZE = 100;

async function refreshAllUnresolved() {
  console.log('🔄 Refreshing ALL unresolved positions (SAFE MODE)...\n');
  const startTime = Date.now();

  // Get current state
  const currentState = await clickhouse.query({
    query: `SELECT countIf(resolved_at IS NULL) as unresolved FROM pm_trade_fifo_roi_v3_mat_unified`,
    format: 'JSONEachRow',
  });
  const current = ((await currentState.json()) as any)[0].unresolved;
  console.log(`   Current unresolved rows: ${Number(current).toLocaleString()}`);

  // Get all unresolved conditions
  console.log('   Finding unresolved conditions...');
  const conditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4 f
      WHERE f.source = 'clob'
        AND f.event_time >= now() - INTERVAL 30 DAY
        AND f.condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0 AND payout_numerators != ''
        )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const conditions = ((await conditionsResult.json()) as { condition_id: string }[]).map((r) => r.condition_id);
  console.log(`   Found ${conditions.length.toLocaleString()} unresolved conditions\n`);

  if (conditions.length === 0) {
    console.log('✅ No unresolved positions to insert');
    return;
  }

  // Insert LONG positions in batches (with anti-join - only insert if not exists)
  console.log('   Inserting LONG positions (anti-join - safe)...');
  const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map((id) => `'${id}'`).join(',');
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // For small condition batches, anti-join is scoped to just those conditions
    // This avoids memory issues from joining against entire 269M row table
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          new.tx_hash, new.wallet, new.condition_id, new.outcome_index,
          new.entry_time, NULL as resolved_at, new.tokens, new.cost_usd,
          0 as tokens_sold_early, new.tokens as tokens_held,
          0 as exit_value, 0 as pnl_usd, 0 as roi, 0 as pct_sold_early,
          new.is_maker_flag as is_maker, 0 as is_closed, 0 as is_short
        FROM (
          SELECT
            _tx_hash as tx_hash, _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
            min(_event_time) as entry_time, sum(_tokens_delta) as tokens, sum(abs(_usdc_delta)) as cost_usd,
            max(_is_maker) as is_maker_flag
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
              any(source) as _source
            FROM pm_canonical_fills_v4
            WHERE condition_id IN (${conditionList})
              AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE _source = 'clob'
            AND _tokens_delta > 0
            AND _wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (_is_self_fill = 1 AND _is_maker = 1)
          GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
          HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
        ) AS new
        WHERE (new.tx_hash, new.wallet, new.condition_id, new.outcome_index) NOT IN (
          SELECT tx_hash, wallet, condition_id, outcome_index
          FROM pm_trade_fifo_roi_v3_mat_unified
          WHERE condition_id IN (${conditionList})
        )
      `,
      clickhouse_settings: { max_execution_time: 300 },
    });

    if (batchNum % 20 === 0 || batchNum === totalBatches) {
      console.log(`     Batch ${batchNum}/${totalBatches}`);
    }
  }

  // Insert SHORT positions in batches (with anti-join - only insert if not exists)
  console.log('   Inserting SHORT positions (anti-join - safe)...');

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map((id) => `'${id}'`).join(',');
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // For small condition batches, anti-join is scoped to just those conditions
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          new.tx_hash, new.wallet, new.condition_id, new.outcome_index,
          new.entry_time, NULL as resolved_at, new.tokens, new.cost_usd,
          0 as tokens_sold_early, new.tokens as tokens_held,
          0 as exit_value, 0 as pnl_usd, 0 as roi, 0 as pct_sold_early,
          0 as is_maker, 0 as is_closed, 1 as is_short
        FROM (
          SELECT
            concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index), '_', toString(toUnixTimestamp(entry_time))) as tx_hash,
            wallet, condition_id, outcome_index, entry_time, abs(net_tokens) as tokens, -cash_flow as cost_usd
          FROM (
            SELECT
              _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
              min(_event_time) as entry_time,
              sum(_tokens_delta) as net_tokens,
              sum(_usdc_delta) as cash_flow
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
                any(is_self_fill) as _is_self_fill,
                any(is_maker) as _is_maker
              FROM pm_canonical_fills_v4
              WHERE condition_id IN (${conditionList})
                AND source = 'clob'
              GROUP BY fill_id
            )
            WHERE _source = 'clob'
              AND _wallet != '0x0000000000000000000000000000000000000000'
              AND NOT (_is_self_fill = 1 AND _is_maker = 1)
            GROUP BY _wallet, _condition_id, _outcome_index
            HAVING sum(_tokens_delta) < -0.01 AND sum(_usdc_delta) > 0.01
          )
        ) AS new
        WHERE (new.wallet, new.condition_id, new.outcome_index) NOT IN (
          SELECT wallet, condition_id, outcome_index
          FROM pm_trade_fifo_roi_v3_mat_unified
          WHERE condition_id IN (${conditionList}) AND is_short = 1
        )
      `,
      clickhouse_settings: { max_execution_time: 300 },
    });

    if (batchNum % 20 === 0 || batchNum === totalBatches) {
      console.log(`     Batch ${batchNum}/${totalBatches}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Final stats
  const stats = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        max(entry_time) as newest_entry
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const s = ((await stats.json()) as any)[0];

  console.log(`\n✅ Refresh complete! (${elapsed} min)`);
  console.log(`   Resolved: ${Number(s.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${Number(s.unresolved).toLocaleString()}`);
  console.log(`   Newest entry: ${s.newest_entry}`);
}

refreshAllUnresolved().catch(console.error);
