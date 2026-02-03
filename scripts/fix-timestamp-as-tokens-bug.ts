/**
 * Fix Timestamp-as-Tokens Bug
 *
 * Fixes 14,947 positions where `tokens` contains a Unix timestamp
 * instead of actual token count.
 *
 * Root cause: Column order mismatch in processPendingResolutions()
 * in refresh-unified-incremental/route.ts - `resolved_at` was at
 * position 6 but table expects `tokens` at position 6.
 *
 * This script:
 * 1. Identifies corrupted positions (tokens = Unix timestamp)
 * 2. Recalculates correct values from pm_canonical_fills_v4
 * 3. Deletes corrupted rows
 * 4. Inserts corrected rows
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function fixTimestampAsTokensBug() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Fix Timestamp-as-Tokens Bug ===\n');

  // Step 1: Identify corrupted conditions
  console.log('Step 1: Identifying corrupted conditions...');
  const corruptedResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3
      WHERE tokens > 1700000000 AND tokens < 1900000000
    `,
    format: 'JSONEachRow',
  });
  const corruptedConditions = (await corruptedResult.json() as { condition_id: string }[]).map(r => r.condition_id);
  console.log(`  Found ${corruptedConditions.length} corrupted conditions`);

  if (corruptedConditions.length === 0) {
    console.log('No corrupted conditions found. Exiting.');
    return;
  }

  // Step 2: Count total corrupted rows
  const countResult = await client.query({
    query: `
      SELECT
        countIf(tokens > 1700000000 AND tokens < 1900000000) as v3_corrupted,
        (SELECT countIf(tokens > 1700000000 AND tokens < 1900000000) FROM pm_trade_fifo_roi_v3_mat_unified) as unified_corrupted
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow',
  });
  const counts = (await countResult.json() as any[])[0];
  console.log(`  V3 table: ${Number(counts.v3_corrupted).toLocaleString()} corrupted rows`);
  console.log(`  Unified table: ${Number(counts.unified_corrupted).toLocaleString()} corrupted rows`);

  const conditionList = corruptedConditions.map(id => `'${id}'`).join(',');

  // Step 3: Delete corrupted rows from both tables
  console.log('\nStep 2: Deleting corrupted rows from pm_trade_fifo_roi_v3...');
  await client.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3
      DELETE WHERE condition_id IN (${conditionList})
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  console.log('Step 3: Deleting corrupted rows from pm_trade_fifo_roi_v3_mat_unified...');
  await client.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE condition_id IN (${conditionList})
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Wait for mutations to complete
  console.log('  Waiting for mutations to complete...');
  let mutationComplete = false;
  let attempts = 0;
  while (!mutationComplete && attempts < 120) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const mutationCheck = await client.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE (table = 'pm_trade_fifo_roi_v3' OR table = 'pm_trade_fifo_roi_v3_mat_unified')
          AND is_done = 0
      `,
      format: 'JSONEachRow',
    });
    const pending = Number((await mutationCheck.json() as any[])[0].pending);
    if (pending === 0) {
      mutationComplete = true;
    }
    attempts++;
    if (attempts % 10 === 0) {
      console.log(`  Still waiting... (${attempts * 2}s, ${pending} pending)`);
    }
  }

  if (!mutationComplete) {
    console.log('  WARNING: Mutations may not be complete. Proceeding anyway.');
  } else {
    console.log('  Mutations complete.');
  }

  // Step 4: Reprocess corrupted conditions with CORRECT FIFO calculation
  console.log('\nStep 4: Reprocessing conditions with correct FIFO calculation...');

  // Process LONG positions
  console.log('  Processing LONG positions...');
  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3
      SELECT
        tx_hash, wallet, condition_id, outcome_index, entry_time,
        tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
        exit_value - cost_usd as pnl_usd,
        CASE WHEN cost_usd > 0.01 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
        CASE WHEN (total_tokens_sold + tokens_held) > 0.01 THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100 ELSE 0 END as pct_sold_early,
        is_maker_flag as is_maker, resolved_at, 0 as is_short,
        CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
      FROM (
        SELECT buy.*,
          coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
          coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
          CASE
            WHEN buy.payout_numerators LIKE '%1000000000000000000%' AND buy.payout_numerators LIKE '%0%' AND buy.outcome_index = 0 AND position(buy.payout_numerators, '1000000000000000000') < position(buy.payout_numerators, ',0') THEN 1.0
            WHEN buy.payout_numerators LIKE '%1000000000000000000%' AND buy.payout_numerators LIKE '%0%' AND buy.outcome_index = 1 AND position(buy.payout_numerators, '1000000000000000000') > position(buy.payout_numerators, ',') THEN 1.0
            WHEN buy.payout_numerators LIKE '%1000000000000000000%' AND buy.payout_numerators LIKE '%1000000000000000000%' THEN 0.5
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
          (CASE WHEN coalesce(sells.total_tokens_sold, 0) > 0.01 THEN
            (least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0))) / coalesce(sells.total_tokens_sold, 0)) * coalesce(sells.total_sell_proceeds, 0)
          ELSE 0 END) +
          ((buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0)))) * CASE
            WHEN buy.payout_numerators LIKE '%1000000000000000000%' AND buy.payout_numerators LIKE '%0%' AND buy.outcome_index = 0 AND position(buy.payout_numerators, '1000000000000000000') < position(buy.payout_numerators, ',0') THEN 1.0
            WHEN buy.payout_numerators LIKE '%1000000000000000000%' AND buy.payout_numerators LIKE '%0%' AND buy.outcome_index = 1 AND position(buy.payout_numerators, '1000000000000000000') > position(buy.payout_numerators, ',') THEN 1.0
            WHEN buy.payout_numerators LIKE '%1000000000000000000%' AND buy.payout_numerators LIKE '%1000000000000000000%' THEN 0.5
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
            WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != '' AND f.source = 'clob'
            GROUP BY fill_id
          )
          WHERE _source = 'clob' AND _tokens_delta > 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (_is_self_fill = 1 AND _is_maker = 1)
          GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
          HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
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
            WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != '' AND f.source = 'clob'
            GROUP BY fill_id
          )
          WHERE _source = 'clob' AND _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            AND _event_time < _resolved_at
          GROUP BY _wallet, _condition_id, _outcome_index
        ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
      )
    `,
    clickhouse_settings: { max_execution_time: 600 },
  });

  // Count inserted LONG positions
  const longCountResult = await client.query({
    query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3 WHERE condition_id IN (${conditionList}) AND is_short = 0`,
    format: 'JSONEachRow',
  });
  const longCount = Number((await longCountResult.json() as any[])[0].cnt);
  console.log(`    Inserted ${longCount.toLocaleString()} LONG positions`);

  // Process SHORT positions
  console.log('  Processing SHORT positions...');
  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3
      SELECT
        concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
        wallet, condition_id, outcome_index, entry_time,
        abs(net_tokens) as tokens,
        abs(cash_flow) as cost_usd,
        0 as tokens_sold_early,
        abs(net_tokens) as tokens_held,
        CASE
          WHEN payout_won = 1 THEN 0
          ELSE abs(net_tokens)
        END as exit_value,
        CASE
          WHEN payout_won = 1 THEN -abs(net_tokens)
          ELSE abs(cash_flow)
        END as pnl_usd,
        CASE
          WHEN abs(cash_flow) > 0.01 THEN
            CASE
              WHEN payout_won = 1 THEN -1.0
              ELSE (abs(cash_flow) / abs(cash_flow))
            END
          ELSE 0
        END as roi,
        0 as pct_sold_early,
        0 as is_maker,
        resolved_at,
        1 as is_short,
        0 as is_closed
      FROM (
        SELECT wallet, condition_id, outcome_index, min(event_time) as entry_time,
          sum(tokens_delta) as net_tokens, sum(usdc_delta) as cash_flow,
          any(_payout_numerators) as payout_numerators, any(_resolved_at) as resolved_at,
          -- Check if the shorted outcome won
          CASE
            WHEN any(_payout_numerators) LIKE '%1000000000000000000%' AND any(_payout_numerators) NOT LIKE '%0%' THEN 1
            WHEN outcome_index = 0 AND position(any(_payout_numerators), '1000000000000000000') < position(any(_payout_numerators), ',') THEN 1
            WHEN outcome_index = 1 AND position(any(_payout_numerators), '1000000000000000000') > position(any(_payout_numerators), ',') THEN 1
            ELSE 0
          END as payout_won
        FROM (
          SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet, any(condition_id) as condition_id,
            any(outcome_index) as outcome_index, any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
            any(source) as source, any(is_self_fill) as is_self_fill, any(is_maker) as is_maker,
            any(r.payout_numerators) as _payout_numerators, any(r.resolved_at) as _resolved_at
          FROM pm_canonical_fills_v4 f
          INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != '' AND f.source = 'clob'
          GROUP BY fill_id
        )
        WHERE source = 'clob' AND wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (is_self_fill = 1 AND is_maker = 1)
        GROUP BY wallet, condition_id, outcome_index
        HAVING net_tokens < -0.01 AND cash_flow > 0.01
      )
    `,
    clickhouse_settings: { max_execution_time: 600 },
  });

  // Count inserted SHORT positions
  const shortCountResult = await client.query({
    query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3 WHERE condition_id IN (${conditionList}) AND is_short = 1`,
    format: 'JSONEachRow',
  });
  const shortCount = Number((await shortCountResult.json() as any[])[0].cnt);
  console.log(`    Inserted ${shortCount.toLocaleString()} SHORT positions`);

  // Step 5: Sync to unified table
  console.log('\nStep 5: Syncing corrected data to unified table...');
  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        v.tx_hash, v.wallet, v.condition_id, v.outcome_index, v.entry_time, v.resolved_at,
        v.tokens, v.cost_usd, v.tokens_sold_early, v.tokens_held, v.exit_value,
        v.pnl_usd, v.roi, v.pct_sold_early, v.is_maker, v.is_closed, v.is_short
      FROM pm_trade_fifo_roi_v3 v
      WHERE v.condition_id IN (${conditionList})
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Step 6: Verification
  console.log('\nStep 6: Verification...');
  const afterResult = await client.query({
    query: `
      SELECT
        'V3' as table_name,
        count() as total,
        countIf(tokens > 1700000000 AND tokens < 1900000000) as still_corrupted,
        sum(pnl_usd) as total_pnl,
        min(tokens) as min_tokens,
        max(tokens) as max_tokens,
        avg(tokens) as avg_tokens
      FROM pm_trade_fifo_roi_v3
      WHERE condition_id IN (${conditionList})
      UNION ALL
      SELECT
        'Unified' as table_name,
        count() as total,
        countIf(tokens > 1700000000 AND tokens < 1900000000) as still_corrupted,
        sum(pnl_usd) as total_pnl,
        min(tokens) as min_tokens,
        max(tokens) as max_tokens,
        avg(tokens) as avg_tokens
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE condition_id IN (${conditionList})
    `,
    format: 'JSONEachRow',
  });
  const afterStats = await afterResult.json() as any[];

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('RESULTS');
  console.log(`${'='.repeat(60)}`);
  for (const stat of afterStats) {
    console.log(`\n${stat.table_name} Table:`);
    console.log(`  Total positions: ${Number(stat.total).toLocaleString()}`);
    console.log(`  Still corrupted: ${Number(stat.still_corrupted).toLocaleString()} (should be 0)`);
    console.log(`  Total PnL: $${Number(stat.total_pnl).toLocaleString()}`);
    console.log(`  Token range: ${Number(stat.min_tokens).toFixed(4)} - ${Number(stat.max_tokens).toFixed(4)}`);
    console.log(`  Avg tokens: ${Number(stat.avg_tokens).toFixed(4)}`);
  }
  console.log(`\nDuration: ${duration}s`);

  // Check global stats
  const globalResult = await client.query({
    query: `
      SELECT
        countIf(tokens > 1700000000 AND tokens < 1900000000) as corrupted_v3,
        (SELECT countIf(tokens > 1700000000 AND tokens < 1900000000) FROM pm_trade_fifo_roi_v3_mat_unified) as corrupted_unified
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow',
  });
  const global = (await globalResult.json() as any[])[0];

  if (Number(global.corrupted_v3) === 0 && Number(global.corrupted_unified) === 0) {
    console.log('\n✓ SUCCESS: All timestamp-as-tokens corruption has been fixed!');
  } else {
    console.log(`\n✗ WARNING: ${Number(global.corrupted_v3).toLocaleString()} V3 rows and ${Number(global.corrupted_unified).toLocaleString()} unified rows still corrupted`);
  }
}

fixTimestampAsTokensBug().catch(console.error);
