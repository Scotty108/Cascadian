#!/usr/bin/env npx tsx
/**
 * Phase 1: 10-Day Unified Table - Single Worker (Batched)
 *
 * Processes NEW wallets (not in 2-day test) in 50 batches
 * Avoids timeout by processing smaller chunks
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const NUM_BATCHES = 50;
const LOOKBACK_DAYS = 10;

async function buildUnified10DaySingle() {
  const startTime = Date.now();
  console.log('🔨 Phase 1: 10-Day Unified Build (Single Worker, Batched)\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log(`📦 Processing in ${NUM_BATCHES} batches\n`);

  // Step 1: Create temp table for 10-day active wallets (excluding 2-day test)
  console.log('1️⃣ Creating temp table for NEW 10-day active wallets...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS temp_active_wallets_10d`
  });
  await clickhouse.command({
    query: `CREATE TABLE temp_active_wallets_10d (wallet LowCardinality(String)) ENGINE = Memory`
  });
  await clickhouse.query({
    query: `
      INSERT INTO temp_active_wallets_10d
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND source = 'clob'
        AND wallet NOT IN (
          SELECT DISTINCT wallet
          FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
        )
    `
  });

  const walletCountResult = await clickhouse.query({
    query: `SELECT count() FROM temp_active_wallets_10d`,
    format: 'JSONEachRow'
  });
  const walletCount = (await walletCountResult.json())[0]['count()'];
  console.log(`   ✅ Found ${walletCount.toLocaleString()} NEW wallets\n`);

  // Step 2: Pre-compute unresolved conditions (OPTIMIZED)
  console.log('2️⃣ Pre-computing unresolved conditions...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS temp_unresolved_conditions_10d`
  });
  await clickhouse.command({
    query: `CREATE TABLE temp_unresolved_conditions_10d (condition_id String) ENGINE = Memory`
  });

  // Use LEFT JOIN instead of NOT IN for better performance
  await clickhouse.query({
    query: `
      INSERT INTO temp_unresolved_conditions_10d
      SELECT DISTINCT f.condition_id
      FROM pm_canonical_fills_v4 f
      LEFT JOIN (
        SELECT condition_id
        FROM pm_condition_resolutions
        WHERE is_deleted = 0 AND payout_numerators != ''
      ) r ON f.condition_id = r.condition_id
      WHERE r.condition_id IS NULL
        AND f.event_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
    `,
    request_timeout: 600000,  // 10 minutes
    clickhouse_settings: {
      max_execution_time: 600 as any,
      send_timeout: 600 as any,
      receive_timeout: 600 as any,
    }
  });

  const conditionCountResult = await clickhouse.query({
    query: `SELECT count() FROM temp_unresolved_conditions_10d`,
    format: 'JSONEachRow'
  });
  const conditionCount = (await conditionCountResult.json())[0]['count()'];
  console.log(`   ✅ Found ${conditionCount.toLocaleString()} unresolved conditions\n`);

  // Step 3: Create target table
  console.log('3️⃣ Creating target table (if not exists)...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_trade_fifo_roi_v3_mat_unresolved_new (
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
  console.log('   ✅ Table ready\n');

  // Step 4: Process LONG positions in batches
  console.log(`4️⃣ Processing LONG positions (${NUM_BATCHES} batches)...\n`);

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const batchStart = Date.now();
    console.log(`   Batch ${batch + 1}/${NUM_BATCHES} (cityHash64(wallet) % ${NUM_BATCHES} = ${batch})...`);

    await clickhouse.query({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_new
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
              SELECT f.fill_id, any(f.tx_hash) as _tx_hash, any(f.event_time) as _event_time, any(f.wallet) as _wallet,
                any(f.condition_id) as _condition_id, any(f.outcome_index) as _outcome_index, any(f.tokens_delta) as _tokens_delta,
                any(f.usdc_delta) as _usdc_delta, any(f.is_maker) as _is_maker, any(f.is_self_fill) as _is_self_fill,
                any(f.source) as _source
              FROM pm_canonical_fills_v4 f
              INNER JOIN temp_active_wallets_10d w ON f.wallet = w.wallet
              INNER JOIN temp_unresolved_conditions_10d c ON f.condition_id = c.condition_id
              WHERE cityHash64(f.wallet) % ${NUM_BATCHES} = ${batch}
              GROUP BY f.fill_id
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
              SELECT f.fill_id, any(f.wallet) as _wallet, any(f.condition_id) as _condition_id,
                any(f.outcome_index) as _outcome_index, any(f.tokens_delta) as _tokens_delta, any(f.usdc_delta) as _usdc_delta,
                any(f.source) as _source
              FROM pm_canonical_fills_v4 f
              INNER JOIN temp_active_wallets_10d w ON f.wallet = w.wallet
              INNER JOIN temp_unresolved_conditions_10d c ON f.condition_id = c.condition_id
              WHERE cityHash64(f.wallet) % ${NUM_BATCHES} = ${batch}
              GROUP BY f.fill_id
            )
            WHERE _source = 'clob' AND _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            GROUP BY _wallet, _condition_id, _outcome_index
          ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
        )
      `,
      request_timeout: 600000,  // 10 minutes per batch
      clickhouse_settings: {
        max_execution_time: 600 as any,
        max_memory_usage: 10000000000 as any,
        send_timeout: 600 as any,
        receive_timeout: 600 as any,
      }
    });

    const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(`      ✅ Batch ${batch + 1} complete (${batchElapsed}s)\n`);
  }

  const longElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ LONG positions complete (${longElapsed} min)\n`);

  // Step 5: Process SHORT positions in batches
  console.log(`5️⃣ Processing SHORT positions (${NUM_BATCHES} batches)...\n`);

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const batchStart = Date.now();
    console.log(`   Batch ${batch + 1}/${NUM_BATCHES}...`);

    await clickhouse.query({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_new
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
            SELECT f.fill_id, any(f.event_time) as event_time, any(f.wallet) as wallet, any(f.condition_id) as condition_id,
              any(f.outcome_index) as outcome_index, any(f.tokens_delta) as tokens_delta, any(f.usdc_delta) as usdc_delta,
              any(f.source) as source, any(f.is_self_fill) as is_self_fill, any(f.is_maker) as is_maker
            FROM pm_canonical_fills_v4 f
            INNER JOIN temp_active_wallets_10d w ON f.wallet = w.wallet
            INNER JOIN temp_unresolved_conditions_10d c ON f.condition_id = c.condition_id
            WHERE cityHash64(f.wallet) % ${NUM_BATCHES} = ${batch}
            GROUP BY f.fill_id
          )
          WHERE source = 'clob' AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING net_tokens < -0.01 AND cash_flow > 0.01
        )
      `,
      request_timeout: 600000,
      clickhouse_settings: {
        max_execution_time: 600 as any,
        max_memory_usage: 10000000000 as any,
        send_timeout: 600 as any,
        receive_timeout: 600 as any,
      }
    });

    const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(`      ✅ Batch ${batch + 1} complete (${batchElapsed}s)\n`);
  }

  const shortElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ SHORT positions complete (${shortElapsed} min)\n`);

  // Step 6: Cleanup
  console.log('6️⃣ Cleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE temp_active_wallets_10d` });
  await clickhouse.command({ query: `DROP TABLE temp_unresolved_conditions_10d` });
  console.log('   ✅ Cleanup complete\n');

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ 10-day build complete in ${totalElapsed} minutes\n`);
}

buildUnified10DaySingle().catch(console.error);
