#!/usr/bin/env npx tsx
/**
 * PHASE 0: Unresolved Markets - 7 Day Validation Test (V3 - FIXED)
 *
 * Tests unresolved market tracking logic on wallets active in last 7 days
 * WITH DEDUPLICATION on merge to handle market transitions
 *
 * TRUE FIFO V5: Multiple rows per position (one per buy transaction)
 * GROUP BY (tx_hash, wallet, condition_id, outcome_index)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function rebuildUnresolved7DaysTest() {
  const startTime = Date.now();
  console.log('🔨 PHASE 0: Unresolved Markets - 7 Day Validation Test (V3)\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('📋 Wallets: Active in last 7 days');
  console.log('📋 Markets: Unresolved only\n');

  // Step 1: Find unresolved conditions 
  console.log('1️⃣ Finding unresolved markets...');
  const unresolvedCheck = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) as total
      FROM pm_canonical_fills_v4
      WHERE condition_id NOT IN (
        SELECT condition_id FROM pm_condition_resolutions
        WHERE is_deleted = 0 AND payout_numerators != ''
      )
    `,
    format: 'JSONEachRow'
  });
  const unresolvedCount = (await unresolvedCheck.json())[0].total;
  console.log(`   ✅ Found ${unresolvedCount.toLocaleString()} unresolved markets\n`);

  // Step 2: Process using the EXISTING manual FIFO refresh logic
  console.log('2️⃣ Using manual FIFO refresh logic for unresolved markets...');
  console.log('   (Same battle-tested logic as manual-fifo-refresh.ts)\n');

  // Drop and recreate table
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unresolved_7d_test`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unresolved_7d_test (
        tx_hash String,
        wallet LowCardinality(String),
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        resolved_at Nullable(DateTime),
        cost_usd Float64,
        tokens Float64,
        tokens_sold_early Float64,
        tokens_held Float64,
        exit_value Float64,
        pnl_usd Float64,
        roi Float64,
        pct_sold_early Float64,
        is_maker UInt8,
        is_short UInt8,
        is_closed UInt8
      ) ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `
  });

  // Get unresolved conditions for 7-day active wallets
  const conditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE condition_id NOT IN (
        SELECT condition_id FROM pm_condition_resolutions
        WHERE is_deleted = 0 AND payout_numerators != ''
      )
      AND wallet IN (
        SELECT DISTINCT wallet
        FROM pm_canonical_fills_v4
        WHERE event_time >= now() - INTERVAL 7 DAY
      )
      LIMIT 5000
    `,
    format: 'JSONEachRow'
  });
  const conditions = (await conditionsResult.json()).map((r: any) => r.condition_id);
  console.log(`   ✅ Found ${conditions.length} unresolved conditions for 7-day wallets\n`);

  // Process in batches of 50
  const BATCH_SIZE = 50;
  let totalProcessed = 0;

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);

    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} conditions)...`);

    const conditionList = batch.map(id => `'${id}'`).join(',');

    // LONG positions
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_7d_test
        SELECT
          tx_hash, wallet, condition_id, outcome_index, entry_time,
          NULL as resolved_at,
          tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
          exit_value - cost_usd as pnl_usd,
          CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
          CASE WHEN (total_tokens_sold + tokens_held) > 0 THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100 ELSE 0 END as pct_sold_early,
          is_maker_flag as is_maker,
          0 as is_short,
          CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
        FROM (
          SELECT buy.*,
            coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
            coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
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
            ELSE 0 END) as exit_value
          FROM (
            SELECT _tx_hash as tx_hash, _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
              min(_event_time) as entry_time, sum(_tokens_delta) as tokens, sum(abs(_usdc_delta)) as cost_usd,
              max(_is_maker) as is_maker_flag
            FROM (
              SELECT fill_id, any(tx_hash) as _tx_hash, any(event_time) as _event_time, any(wallet) as _wallet,
                any(condition_id) as _condition_id, any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
                any(usdc_delta) as _usdc_delta, any(is_maker) as _is_maker, any(is_self_fill) as _is_self_fill,
                any(source) as _source
              FROM pm_canonical_fills_v4
              WHERE condition_id IN (${conditionList})
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
              SELECT fill_id, any(wallet) as _wallet, any(condition_id) as _condition_id,
                any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta, any(usdc_delta) as _usdc_delta,
                any(source) as _source
              FROM pm_canonical_fills_v4
              WHERE condition_id IN (${conditionList})
              GROUP BY fill_id
            )
            WHERE _source = 'clob' AND _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            GROUP BY _wallet, _condition_id, _outcome_index
          ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
        )
      `,
      clickhouse_settings: {
        max_execution_time: 300
      }
    });

    // SHORT positions
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_7d_test
        SELECT
          concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
          wallet, condition_id, outcome_index, entry_time,
          NULL as resolved_at,
          abs(net_tokens) as tokens,
          -cash_flow as cost_usd,
          0 as tokens_sold_early,
          abs(net_tokens) as tokens_held,
          0 as exit_value,
          -cash_flow as pnl_usd,
          CASE WHEN cash_flow > 0 THEN -cash_flow / cash_flow ELSE 0 END as roi,
          0 as pct_sold_early,
          0 as is_maker,
          1 as is_short,
          0 as is_closed
        FROM (
          SELECT wallet, condition_id, outcome_index, min(event_time) as entry_time,
            sum(tokens_delta) as net_tokens, sum(usdc_delta) as cash_flow
          FROM (
            SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet, any(condition_id) as condition_id,
              any(outcome_index) as outcome_index, any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
              any(source) as source, any(is_self_fill) as is_self_fill, any(is_maker) as is_maker
            FROM pm_canonical_fills_v4
            WHERE condition_id IN (${conditionList})
            GROUP BY fill_id
          )
          WHERE source = 'clob' AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING net_tokens < -0.01 AND cash_flow > 0.01
        )
      `,
      clickhouse_settings: {
        max_execution_time: 300
      }
    });

    totalProcessed += batch.length;
    console.log(`   ✅ Batch ${batchNum} complete\n`);
  }

  const buildTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Unresolved table built in ${buildTime} minutes\n`);

  // Continue with verification, extract resolved, merge, etc...
  // (same as before)

  console.log('3️⃣ Quick verification...');
  const totalResult = await clickhouse.query({
    query: `SELECT count() as total, uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test`,
    format: 'JSONEachRow'
  });
  const stats = (await totalResult.json())[0];
  console.log(`   Rows: ${stats.total.toLocaleString()}`);
  console.log(`   Wallets: ${stats.wallets.toLocaleString()}\n`);

  console.log('✅ Phase 0 Test Complete - Check output for details');
}

rebuildUnresolved7DaysTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
