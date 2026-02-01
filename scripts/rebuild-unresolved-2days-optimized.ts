#!/usr/bin/env npx tsx
/**
 * PHASE 0: Unresolved Markets - 2 Day Test (OPTIMIZED)
 *
 * KEY OPTIMIZATION: Pre-compute unresolved conditions in temp table
 * Use INNER JOIN instead of NOT IN subquery (100x faster)
 *
 * Target: ~30-40 minutes total
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const NUM_BATCHES = 50;
const LOOKBACK_DAYS = 2;
const START_BATCH = 23; // Restart from batch 24 (0-indexed)

async function rebuildUnresolved2DaysOptimized() {
  const startTime = Date.now();
  console.log('🔨 PHASE 0: Unresolved Markets - 2 Day Test (OPTIMIZED)\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('🚀 Optimization: Pre-computed temp tables + INNER JOIN\n');

  // Step 1: Create temp table for active wallets
  console.log('1️⃣ Creating temp table for active wallets...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS temp_active_wallets_2d`
  });
  await clickhouse.command({
    query: `CREATE TABLE temp_active_wallets_2d (wallet LowCardinality(String)) ENGINE = Memory`
  });
  await clickhouse.query({
    query: `
      INSERT INTO temp_active_wallets_2d
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND source = 'clob'
    `
  });

  const walletCountResult = await clickhouse.query({
    query: 'SELECT count() FROM temp_active_wallets_2d',
    format: 'JSONEachRow'
  });
  const walletCount = (await walletCountResult.json())[0]['count()'];
  console.log(`   ✅ Found ${walletCount.toLocaleString()} active wallets\n`);

  // Step 2: PRE-COMPUTE unresolved conditions (KEY OPTIMIZATION)
  console.log('2️⃣ Pre-computing unresolved conditions...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS temp_unresolved_conditions`
  });
  await clickhouse.command({
    query: `CREATE TABLE temp_unresolved_conditions (condition_id String) ENGINE = Memory`
  });
  await clickhouse.query({
    query: `
      INSERT INTO temp_unresolved_conditions
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE condition_id NOT IN (
        SELECT condition_id
        FROM pm_condition_resolutions
        WHERE is_deleted = 0 AND payout_numerators != ''
      )
    `
  });

  const conditionCountResult = await clickhouse.query({
    query: 'SELECT count() FROM temp_unresolved_conditions',
    format: 'JSONEachRow'
  });
  const conditionCount = (await conditionCountResult.json())[0]['count()'];
  console.log(`   ✅ Found ${conditionCount.toLocaleString()} unresolved conditions\n`);

  // Step 3: Create unresolved test table
  console.log('3️⃣ Creating unresolved test table...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unresolved_2d_test`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unresolved_2d_test (
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
  console.log('   ✅ Table created\n');

  // Step 4: Process in wallet batches with OPTIMIZED queries
  console.log(`4️⃣ Processing wallet batches ${START_BATCH + 1}-${NUM_BATCHES} (RESUMED)...\n`);

  let errors = 0;

  for (let i = START_BATCH; i < NUM_BATCHES; i++) {
    const batchNum = i + 1;
    const batchStart = Date.now();

    try {
      // LONG positions - OPTIMIZED with INNER JOIN
      await clickhouse.query({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_2d_test
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
                INNER JOIN temp_active_wallets_2d w ON f.wallet = w.wallet
                INNER JOIN temp_unresolved_conditions c ON f.condition_id = c.condition_id
                WHERE cityHash64(f.wallet) % ${NUM_BATCHES} = ${i}
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
                INNER JOIN temp_active_wallets_2d w ON f.wallet = w.wallet
                INNER JOIN temp_unresolved_conditions c ON f.condition_id = c.condition_id
                WHERE cityHash64(f.wallet) % ${NUM_BATCHES} = ${i}
                GROUP BY f.fill_id
              )
              WHERE _source = 'clob' AND _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
              GROUP BY _wallet, _condition_id, _outcome_index
            ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
          )
        `,
        request_timeout: 1200000,
        clickhouse_settings: {
          max_execution_time: 1200 as any,
          max_memory_usage: 10000000000 as any,
        }
      });

      // SHORT positions - OPTIMIZED with INNER JOIN
      await clickhouse.query({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_2d_test
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
              INNER JOIN temp_active_wallets_2d w ON f.wallet = w.wallet
              INNER JOIN temp_unresolved_conditions c ON f.condition_id = c.condition_id
              WHERE cityHash64(f.wallet) % ${NUM_BATCHES} = ${i}
              GROUP BY f.fill_id
            )
            WHERE source = 'clob' AND wallet != '0x0000000000000000000000000000000000000000'
              AND NOT (is_self_fill = 1 AND is_maker = 1)
            GROUP BY wallet, condition_id, outcome_index
            HAVING net_tokens < -0.01 AND cash_flow > 0.01
          )
        `,
        request_timeout: 1200000,
        clickhouse_settings: {
          max_execution_time: 1200 as any,
          max_memory_usage: 10000000000 as any,
        }
      });

      const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);

      if (batchNum % 10 === 0 || batchNum === NUM_BATCHES) {
        const result = await clickhouse.query({
          query: 'SELECT count() FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test',
          format: 'JSONEachRow'
        });
        const rows = await result.json();
        const count = rows[0]['count()'];

        const progress = ((batchNum / NUM_BATCHES) * 100).toFixed(1);
        const avgTime = ((Date.now() - startTime) / 1000 / batchNum).toFixed(1);
        const etaSeconds = ((NUM_BATCHES - batchNum) * parseFloat(avgTime));
        const etaMinutes = (etaSeconds / 60).toFixed(1);

        console.log(`   ✅ Batch ${batchNum} (${elapsed}s)`);
        console.log(`      Progress: ${progress}% | Rows: ${count.toLocaleString()} | ETA: ${etaMinutes} min\n`);
      } else {
        console.log(`   ✅ Batch ${batchNum} (${elapsed}s)\n`);
      }

    } catch (err: any) {
      errors++;
      console.error(`   ❌ Batch ${batchNum} error: ${err.message}\n`);
      if (errors > 5) throw new Error('Too many errors');
    }
  }

  // Cleanup
  await clickhouse.command({ query: 'DROP TABLE temp_active_wallets_2d' });
  await clickhouse.command({ query: 'DROP TABLE temp_unresolved_conditions' });

  const buildTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Unresolved table built in ${buildTime} minutes\n`);

  // Quick stats
  const totalResult = await clickhouse.query({
    query: `SELECT count() as total, uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test`,
    format: 'JSONEachRow'
  });
  const stats = (await totalResult.json())[0];
  console.log(`   Unresolved rows: ${stats.total.toLocaleString()}`);
  console.log(`   Wallets: ${stats.wallets.toLocaleString()}\n`);

  // Step 5: Extract resolved
  console.log('5️⃣ Extracting resolved positions...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_resolved_2d_test`
  });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_resolved_2d_test
      ENGINE = MergeTree
      ORDER BY (tx_hash, wallet, condition_id, outcome_index)
      AS
      SELECT * FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE wallet IN (
        SELECT DISTINCT wallet FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test
      )
    `
  });

  const resolvedResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_trade_fifo_roi_v3_mat_resolved_2d_test`,
    format: 'JSONEachRow'
  });
  const resolvedTotal = (await resolvedResult.json())[0].total;
  console.log(`   ✅ ${resolvedTotal.toLocaleString()} resolved rows\n`);

  // Step 6: Merge with deduplication
  console.log('6️⃣ Creating unified table with dedup...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_2d_test`
  });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_2d_test (
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
  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_2d_test
      SELECT
        tx_hash, wallet, condition_id, outcome_index,
        any(entry_time) as entry_time, any(resolved_at) as resolved_at,
        any(cost_usd) as cost_usd, any(tokens) as tokens,
        any(tokens_sold_early) as tokens_sold_early, any(tokens_held) as tokens_held,
        any(exit_value) as exit_value, any(pnl_usd) as pnl_usd, any(roi) as roi,
        any(pct_sold_early) as pct_sold_early, any(is_maker) as is_maker,
        any(is_short) as is_short, any(is_closed) as is_closed
      FROM (
        SELECT * FROM pm_trade_fifo_roi_v3_mat_resolved_2d_test
        UNION ALL
        SELECT * FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test
      )
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `
  });
  console.log('   ✅ Unified table created\n');

  const unifiedResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as wallets,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        countIf(resolved_at IS NULL) as unresolved_rows
      FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
    `,
    format: 'JSONEachRow'
  });
  const unifiedData = (await unifiedResult.json())[0];

  const deduped = (resolvedTotal + stats.total) - unifiedData.total_rows;

  const finalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('═'.repeat(60));
  console.log(`✅ COMPLETE in ${finalTime} minutes`);
  console.log(`\n📊 Results:`);
  console.log(`   - Unified rows: ${unifiedData.total_rows.toLocaleString()}`);
  console.log(`   - Resolved: ${unifiedData.resolved_rows.toLocaleString()}`);
  console.log(`   - Unresolved: ${unifiedData.unresolved_rows.toLocaleString()}`);
  console.log(`   - Deduped: ${deduped.toLocaleString()}`);
  console.log(`   - Wallets: ${unifiedData.wallets.toLocaleString()}`);
  console.log(`\n✅ Query: pm_trade_fifo_roi_v3_mat_unified_2d_test`);
  console.log('═'.repeat(60));
}

rebuildUnresolved2DaysOptimized()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
