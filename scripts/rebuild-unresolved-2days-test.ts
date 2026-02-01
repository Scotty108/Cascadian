#!/usr/bin/env npx tsx
/**
 * PHASE 0: Unresolved Markets - 2 Day Validation Test
 *
 * Tests unresolved market tracking logic on wallets active in last 2 days
 * WITH DEDUPLICATION on merge to handle market transitions
 *
 * TRUE FIFO V5: Multiple rows per position (one per buy transaction)
 * GROUP BY (tx_hash, wallet, condition_id, outcome_index)
 *
 * Expected: 161k wallets, 35-50 minute runtime
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const BATCH_SIZE = 50;
const LOOKBACK_DAYS = 2;

async function rebuildUnresolved2DaysTest() {
  const startTime = Date.now();
  console.log('🔨 PHASE 0: Unresolved Markets - 2 Day Validation Test\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log(`📋 Filter: Wallets active in last ${LOOKBACK_DAYS} days`);
  console.log('📋 Markets: Unresolved only\n');

  // Step 1: Drop and recreate unresolved test table
  console.log('1️⃣ Creating unresolved test table...');
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

  // Step 2: Get unresolved conditions for 2-day active wallets
  console.log('2️⃣ Finding unresolved conditions for 2-day active wallets...');
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
        WHERE event_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
          AND source = 'clob'
      )
    `,
    format: 'JSONEachRow'
  });
  const conditions = (await conditionsResult.json()).map((r: any) => r.condition_id);
  console.log(`   ✅ Found ${conditions.length.toLocaleString()} unresolved conditions\n`);

  if (conditions.length === 0) {
    console.log('⚠️  No unresolved conditions found. Exiting.');
    return;
  }

  // Step 3: Process in batches using battle-tested FIFO logic
  console.log(`3️⃣ Processing unresolved positions (${Math.ceil(conditions.length / BATCH_SIZE)} batches)...\n`);

  let totalProcessed = 0;
  let errors = 0;

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);

    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} conditions)...`);

    const conditionList = batch.map(id => `'${id}'`).join(',');

    try {
      // LONG positions
      await clickhouse.command({
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

    } catch (err: any) {
      errors++;
      console.error(`   ❌ Batch ${batchNum} error: ${err.message}\n`);
    }
  }

  const buildTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Unresolved table built in ${buildTime} minutes\n`);

  // Step 4: Verification
  console.log('4️⃣ Verifying unresolved table...\n');

  const totalResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test`,
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json())[0].total;

  const walletsResult = await clickhouse.query({
    query: `SELECT uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test`,
    format: 'JSONEachRow'
  });
  const wallets = (await walletsResult.json())[0].wallets;

  const closedResult = await clickhouse.query({
    query: `
      SELECT
        countIf(is_closed = 1) as closed_positions,
        countIf(is_closed = 0) as open_positions,
        countIf(resolved_at IS NOT NULL) as resolved_count,
        countIf(resolved_at IS NULL) as unresolved_count
      FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test
    `,
    format: 'JSONEachRow'
  });
  const closedData = (await closedResult.json())[0];

  console.log(`   Total rows: ${total.toLocaleString()}`);
  console.log(`   Wallets: ${wallets.toLocaleString()}`);
  console.log(`   Closed positions: ${closedData.closed_positions.toLocaleString()}`);
  console.log(`   Open positions: ${closedData.open_positions.toLocaleString()}`);
  console.log(`   Resolved (should be 0): ${closedData.resolved_count.toLocaleString()}`);
  console.log(`   Unresolved: ${closedData.unresolved_count.toLocaleString()}\n`);

  if (closedData.resolved_count === 0) {
    console.log('   ✅ All positions from unresolved markets!\n');
  } else {
    console.log(`   ⚠️  Found ${closedData.resolved_count} resolved positions (unexpected)\n`);
  }

  // Step 5: Extract resolved positions for same wallets
  console.log('5️⃣ Extracting resolved positions for same wallets...');

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_resolved_2d_test`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_resolved_2d_test AS
      SELECT * FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE wallet IN (
        SELECT DISTINCT wallet
        FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test
      )
    `
  });

  const resolvedResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_trade_fifo_roi_v3_mat_resolved_2d_test`,
    format: 'JSONEachRow'
  });
  const resolvedTotal = (await resolvedResult.json())[0].total;
  console.log(`   ✅ Extracted ${resolvedTotal.toLocaleString()} resolved rows\n`);

  // Step 6: Create unified test table WITH DEDUPLICATION
  console.log('6️⃣ Creating unified test table with deduplication...');
  console.log('   (Handles market transitions during build)\n');

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

  // Insert with deduplication to handle market transitions
  console.log('   Merging with GROUP BY deduplication...');
  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_2d_test
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        any(entry_time) as entry_time,
        any(resolved_at) as resolved_at,
        any(cost_usd) as cost_usd,
        any(tokens) as tokens,
        any(tokens_sold_early) as tokens_sold_early,
        any(tokens_held) as tokens_held,
        any(exit_value) as exit_value,
        any(pnl_usd) as pnl_usd,
        any(roi) as roi,
        any(pct_sold_early) as pct_sold_early,
        any(is_maker) as is_maker,
        any(is_short) as is_short,
        any(is_closed) as is_closed
      FROM (
        SELECT * FROM pm_trade_fifo_roi_v3_mat_resolved_2d_test
        UNION ALL
        SELECT * FROM pm_trade_fifo_roi_v3_mat_unresolved_2d_test
      )
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `
  });
  console.log('   ✅ Unified table created\n');

  // Step 7: Verify unified table
  console.log('7️⃣ Verifying unified table...\n');

  const unifiedResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as wallets,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        countIf(resolved_at IS NULL) as unresolved_rows,
        countIf(is_closed = 1) as closed_positions,
        countIf(is_closed = 0) as open_positions
      FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
    `,
    format: 'JSONEachRow'
  });
  const unifiedData = (await unifiedResult.json())[0];

  const expectedTotal = resolvedTotal + total;
  const actualTotal = unifiedData.total_rows;
  const deduped = expectedTotal - actualTotal;

  console.log(`   Total rows: ${unifiedData.total_rows.toLocaleString()}`);
  console.log(`   Wallets: ${unifiedData.wallets.toLocaleString()}`);
  console.log(`   Resolved: ${unifiedData.resolved_rows.toLocaleString()}`);
  console.log(`   Unresolved: ${unifiedData.unresolved_rows.toLocaleString()}`);
  console.log(`   Closed: ${unifiedData.closed_positions.toLocaleString()}`);
  console.log(`   Open: ${unifiedData.open_positions.toLocaleString()}\n`);

  console.log(`   Expected (before dedup): ${expectedTotal.toLocaleString()}`);
  console.log(`   Actual (after dedup): ${actualTotal.toLocaleString()}`);
  console.log(`   Deduped: ${deduped.toLocaleString()}\n`);

  if (deduped > 0) {
    console.log(`   ✅ Deduplication worked: removed ${deduped.toLocaleString()} market transitions\n`);
  } else if (actualTotal === expectedTotal) {
    console.log(`   ✅ No market transitions during build\n`);
  }

  // Step 8: Test sample queries
  console.log('8️⃣ Testing sample queries...\n');

  const leaderboardResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        sum(pnl_usd) as total_pnl,
        count() as total_positions,
        countIf(is_closed = 1) as closed_positions,
        countIf(resolved_at IS NOT NULL) as resolved_positions,
        countIf(resolved_at IS NULL) as unresolved_positions
      FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
      GROUP BY wallet
      ORDER BY total_pnl DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const leaderboardData = await leaderboardResult.json();

  console.log(`   Top 5 wallets by PnL:`);
  leaderboardData.forEach((row: any, i: number) => {
    console.log(`     ${i+1}. ${row.wallet.substring(0,10)}... | PnL: $${row.total_pnl.toFixed(2)} | ${row.total_positions} pos (${row.resolved_positions} res, ${row.unresolved_positions} unres, ${row.closed_positions} closed)`);
  });
  console.log();

  const finalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('═'.repeat(60));
  console.log(`✅ PHASE 0 TEST COMPLETE in ${finalTime} minutes`);
  console.log(`\n📊 Final Results:`);
  console.log(`   - Unresolved rows: ${total.toLocaleString()}`);
  console.log(`   - Resolved rows: ${resolvedTotal.toLocaleString()}`);
  console.log(`   - Unified rows: ${unifiedData.total_rows.toLocaleString()}`);
  console.log(`   - Deduped: ${deduped.toLocaleString()}`);
  console.log(`   - Wallets: ${unifiedData.wallets.toLocaleString()}`);
  console.log(`   - Errors: ${errors}`);

  console.log(`\n📊 Tables Created:`);
  console.log(`   - pm_trade_fifo_roi_v3_mat_unresolved_2d_test (${total.toLocaleString()} rows)`);
  console.log(`   - pm_trade_fifo_roi_v3_mat_resolved_2d_test (${resolvedTotal.toLocaleString()} rows)`);
  console.log(`   - pm_trade_fifo_roi_v3_mat_unified_2d_test (${unifiedData.total_rows.toLocaleString()} rows)`);

  if (errors === 0 && closedData.resolved_count === 0) {
    console.log(`\n✅ VALIDATION SUCCESSFUL!`);
    console.log(`\n📋 Next Steps:`);
    console.log(`   1. Manually verify 5-10 known wallets`);
    console.log(`   2. Check for NegRisk markets`);
    console.log(`   3. If all good, proceed to Phase 1 (full backfill)`);
  } else {
    console.log(`\n⚠️  REVIEW NEEDED: Check warnings above`);
  }
  console.log('═'.repeat(60));
}

rebuildUnresolved2DaysTest()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
