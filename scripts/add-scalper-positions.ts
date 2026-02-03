/**
 * Add Scalper Positions to Unified Table
 *
 * Adds unresolved positions with partial/full sales (scalper profits).
 * Fixed SQL - avoids aggregate function naming collision.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function addScalperPositions() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Add Scalper Positions ===\n');

  // Check current state
  const currentCount = await client.query({
    query: `SELECT count() as cnt, countIf(resolved_at IS NULL) as unresolved FROM pm_trade_fifo_roi_v3_mat_unified`,
    format: 'JSONEachRow',
  });
  const current = (await currentCount.json() as any[])[0];
  console.log(`Current: ${current.cnt.toLocaleString()} rows, ${current.unresolved.toLocaleString()} unresolved`);

  // Get unresolved conditions
  const unresolvedResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
        )
        AND condition_id != ''
        AND wallet != '0x0000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 },
  });
  const unresolvedConditions = (await unresolvedResult.json() as { condition_id: string }[]).map(r => r.condition_id);
  console.log(`Found ${unresolvedConditions.length.toLocaleString()} unresolved conditions to process\n`);

  // Process in batches
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  for (let i = 0; i < unresolvedConditions.length; i += BATCH_SIZE) {
    const batch = unresolvedConditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map(id => `'${id}'`).join(',');

    try {
      const beforeCount = await client.query({
        query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified`,
        format: 'JSONEachRow',
      });
      const before = (await beforeCount.json() as any[])[0].cnt;

      // Fixed query - use explicit column names without aggregate in GROUP BY
      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified
          SELECT
            first_tx as tx_hash,
            w as wallet,
            cond as condition_id,
            outcome as outcome_index,
            first_time as entry_time,
            NULL as resolved_at,
            tokens_bought as tokens,
            total_cost as cost_usd,
            sold_early as tokens_sold_early,
            held as tokens_held,
            proceeds as exit_value,
            pnl as pnl_usd,
            roi_calc as roi,
            pct_sold as pct_sold_early,
            maker as is_maker,
            closed as is_closed,
            0 as is_short
          FROM (
            SELECT
              fills._wallet as w,
              fills._cond as cond,
              fills._outcome as outcome,
              any(fills._tx) as first_tx,
              min(fills._time) as first_time,
              sum(if(fills._tokens > 0, fills._tokens, 0)) as tokens_bought,
              sum(if(fills._tokens < 0, abs(fills._tokens), 0)) as tokens_sold,
              sum(fills._tokens) as net_tokens,
              sum(if(fills._tokens > 0, abs(fills._usdc), 0)) as total_cost,
              sum(if(fills._tokens < 0, abs(fills._usdc), 0)) as proceeds,
              max(fills._maker) as maker,
              -- Derived
              least(sum(if(fills._tokens < 0, abs(fills._tokens), 0)), sum(if(fills._tokens > 0, fills._tokens, 0))) as sold_early,
              greatest(0, sum(fills._tokens)) as held,
              -- PnL: proceeds - (sold/bought * cost)
              if(sum(if(fills._tokens > 0, fills._tokens, 0)) > 0.01,
                sum(if(fills._tokens < 0, abs(fills._usdc), 0)) -
                (least(sum(if(fills._tokens < 0, abs(fills._tokens), 0)), sum(if(fills._tokens > 0, fills._tokens, 0))) /
                 sum(if(fills._tokens > 0, fills._tokens, 0)) * sum(if(fills._tokens > 0, abs(fills._usdc), 0))),
                0) as pnl,
              -- ROI
              if(sum(if(fills._tokens > 0, abs(fills._usdc), 0)) > 0.01 AND sum(if(fills._tokens < 0, abs(fills._tokens), 0)) > 0.01,
                (sum(if(fills._tokens < 0, abs(fills._usdc), 0)) -
                 (least(sum(if(fills._tokens < 0, abs(fills._tokens), 0)), sum(if(fills._tokens > 0, fills._tokens, 0))) /
                  sum(if(fills._tokens > 0, fills._tokens, 0)) * sum(if(fills._tokens > 0, abs(fills._usdc), 0)))) /
                (least(sum(if(fills._tokens < 0, abs(fills._tokens), 0)), sum(if(fills._tokens > 0, fills._tokens, 0))) /
                 sum(if(fills._tokens > 0, fills._tokens, 0)) * sum(if(fills._tokens > 0, abs(fills._usdc), 0))),
                0) as roi_calc,
              -- Pct sold
              if(sum(if(fills._tokens > 0, fills._tokens, 0)) > 0,
                least(sum(if(fills._tokens < 0, abs(fills._tokens), 0)), sum(if(fills._tokens > 0, fills._tokens, 0))) /
                sum(if(fills._tokens > 0, fills._tokens, 0)) * 100, 0) as pct_sold,
              -- Closed
              if(sum(fills._tokens) <= 0.01, 1, 0) as closed
            FROM (
              SELECT fill_id, any(tx_hash) as _tx, any(event_time) as _time,
                any(wallet) as _wallet, any(condition_id) as _cond,
                any(outcome_index) as _outcome, any(tokens_delta) as _tokens,
                any(usdc_delta) as _usdc, any(is_maker) as _maker,
                any(is_self_fill) as _self
              FROM pm_canonical_fills_v4
              WHERE condition_id IN (${conditionList}) AND source = 'clob'
              GROUP BY fill_id
            ) AS fills
            WHERE fills._wallet != '0x0000000000000000000000000000000000000000'
              AND NOT (fills._self = 1 AND fills._maker = 1)
            GROUP BY fills._wallet, fills._cond, fills._outcome
            HAVING total_cost > 0.01 AND tokens_sold > 0.01
          )
        `,
        clickhouse_settings: { max_execution_time: 180 },
      });

      const afterCount = await client.query({
        query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified`,
        format: 'JSONEachRow',
      });
      const after = (await afterCount.json() as any[])[0].cnt;
      const inserted = after - before;
      totalInserted += inserted;

      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(unresolvedConditions.length / BATCH_SIZE)}: +${inserted.toLocaleString()} positions`);
    } catch (error: any) {
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ERROR - ${error.message.substring(0, 100)}`);
    }
  }

  // Final stats
  const finalCount = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NULL) as unresolved,
        countIf(resolved_at IS NULL AND pct_sold_early > 0) as scalpers
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const final = (await finalCount.json() as any[])[0];

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(50)}`);
  console.log('RESULTS');
  console.log(`${'='.repeat(50)}`);
  console.log(`Total rows: ${final.total.toLocaleString()}`);
  console.log(`Unresolved: ${final.unresolved.toLocaleString()}`);
  console.log(`Scalpers: ${final.scalpers.toLocaleString()}`);
  console.log(`Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`Duration: ${duration}s`);
}

addScalperPositions().catch(console.error);
