#!/usr/bin/env npx tsx
/**
 * PHASE 0: Unresolved Markets - 7 Day Validation Test
 *
 * Tests unresolved market tracking logic on wallets active in last 7 days
 *
 * TRUE FIFO V5: Multiple rows per position (one per buy transaction)
 * GROUP BY (tx_hash, wallet, condition_id, outcome_index)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function rebuildUnresolved7DaysTest() {
  const startTime = Date.now();
  console.log('🔨 PHASE 0: Unresolved Markets - 7 Day Validation Test\n');
  console.log('⏰ Started at:', new Date().toLocaleString());

  // Step 1: Drop and recreate test table
  console.log('1️⃣ Recreating test table...');
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
  console.log('   ✅ Table created\n');

  // Step 2: Process UNRESOLVED positions for wallets active in last 7 days
  console.log('2️⃣ Processing UNRESOLVED positions (last 7 days active wallets)...\n');
  console.log('   🔑 GROUP BY: (tx_hash, wallet, condition_id, outcome_index)');
  console.log('   📋 TRUE FIFO V5: Multiple rows per position (one per buy tx)');
  console.log('   🎯 Filter: Wallets active in last 7 days, unresolved markets only\n');

  const insertStart = Date.now();

  // Process LONG positions on unresolved markets
  console.log('   Processing LONG positions (unresolved markets)...');
  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_7d_test
      SELECT
        tx_hash, wallet, condition_id, outcome_index, entry_time,
        NULL as resolved_at,  -- Market not resolved yet
        tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
        exit_value - cost_usd as pnl_usd,
        CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
        CASE WHEN (total_tokens_sold + tokens_held) > 0 THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100 ELSE 0 END as pct_sold_early,
        is_maker_flag as is_maker,
        0 as is_short,
        CASE WHEN tokens_held = 0 THEN 1 ELSE 0 END as is_closed  -- Fully exited = closed
      FROM (
        SELECT buy.*,
          coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
          coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
          -- Early sells: FIFO allocation
          least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_sold_early,
          -- Remaining tokens still held
          buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_held,
          -- Exit value = ONLY sell proceeds (no payout, market not resolved)
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
            FROM pm_canonical_fills_v4 f
            WHERE f.wallet IN (
              SELECT DISTINCT wallet
              FROM pm_canonical_fills_v4
              WHERE event_time >= now() - INTERVAL 7 DAY
            )
            AND f.condition_id NOT IN (
              SELECT condition_id
              FROM pm_condition_resolutions
              WHERE is_deleted = 0 AND payout_numerators != ''
            )
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
            FROM pm_canonical_fills_v4 f
            WHERE f.wallet IN (
              SELECT DISTINCT wallet
              FROM pm_canonical_fills_v4
              WHERE event_time >= now() - INTERVAL 7 DAY
            )
            AND f.condition_id NOT IN (
              SELECT condition_id
              FROM pm_condition_resolutions
              WHERE is_deleted = 0 AND payout_numerators != ''
            )
            GROUP BY fill_id
          )
          WHERE _source = 'clob' AND _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
          GROUP BY _wallet, _condition_id, _outcome_index
        ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
      )
    `,
    request_timeout: 600000,
    clickhouse_settings: {
      max_execution_time: 600 as any,
      max_memory_usage: 10000000000 as any,
    }
  });
  console.log('   ✅ LONG positions processed\n');

  // Process SHORT positions on unresolved markets
  console.log('   Processing SHORT positions (unresolved markets)...');
  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unresolved_7d_test
      SELECT
        concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
        wallet, condition_id, outcome_index, entry_time,
        NULL as resolved_at,  -- Market not resolved yet
        abs(net_tokens) as tokens,
        -cash_flow as cost_usd,  -- Cost is negative for shorts
        0 as tokens_sold_early,
        abs(net_tokens) as tokens_held,  -- Still holding short position
        0 as exit_value,  -- No exit yet (market not resolved)
        -cash_flow as pnl_usd,  -- Current PnL = cash received (no exit yet)
        CASE WHEN cash_flow > 0 THEN -cash_flow / cash_flow ELSE 0 END as roi,
        0 as pct_sold_early,
        0 as is_maker,
        1 as is_short,
        0 as is_closed  -- SHORT positions are considered open until market resolves
      FROM (
        SELECT wallet, condition_id, outcome_index, min(event_time) as entry_time,
          sum(tokens_delta) as net_tokens, sum(usdc_delta) as cash_flow
        FROM (
          SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet, any(condition_id) as condition_id,
            any(outcome_index) as outcome_index, any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
            any(source) as source, any(is_self_fill) as is_self_fill, any(is_maker) as is_maker
          FROM pm_canonical_fills_v4 f
          WHERE f.wallet IN (
            SELECT DISTINCT wallet
            FROM pm_canonical_fills_v4
            WHERE event_time >= now() - INTERVAL 7 DAY
          )
          AND f.condition_id NOT IN (
            SELECT condition_id
            FROM pm_condition_resolutions
            WHERE is_deleted = 0 AND payout_numerators != ''
          )
          GROUP BY fill_id
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
    }
  });
  console.log('   ✅ SHORT positions processed\n');

  const insertDuration = ((Date.now() - insertStart) / 1000).toFixed(1);
  console.log(`   ✅ Populated in ${insertDuration} seconds\n`);

  // Step 3: Verification
  console.log('3️⃣ Verification...\\n');

  const totalResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test`,
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json())[0].total;

  const uniqueResult = await clickhouse.query({
    query: `SELECT uniq(tx_hash, wallet, condition_id, outcome_index) as unique_keys FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test`,
    format: 'JSONEachRow'
  });
  const unique = (await uniqueResult.json())[0].unique_keys;

  const walletsResult = await clickhouse.query({
    query: `SELECT uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test`,
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
      FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test
    `,
    format: 'JSONEachRow'
  });
  const closedData = (await closedResult.json())[0];

  console.log(`   Total rows: ${total.toLocaleString()}`);
  console.log(`   Unique keys: ${unique.toLocaleString()}`);
  console.log(`   Duplicates: ${(total - unique).toLocaleString()}`);
  console.log(`   Wallets: ${wallets.toLocaleString()}\n`);

  console.log(`   Closed positions: ${closedData.closed_positions.toLocaleString()}`);
  console.log(`   Open positions: ${closedData.open_positions.toLocaleString()}`);
  console.log(`   Resolved markets: ${closedData.resolved_count.toLocaleString()} (should be 0)`);
  console.log(`   Unresolved markets: ${closedData.unresolved_count.toLocaleString()}\n`);

  if (total === unique) {
    console.log('   ✅ ZERO DUPLICATES!\n');
  } else {
    console.log(`   ⚠️  Note: ${(total - unique).toLocaleString()} approximate difference (uniq() has ~2% margin)\n`);
  }

  if (closedData.resolved_count === 0) {
    console.log('   ✅ All positions are from unresolved markets!\n');
  } else {
    console.log(`   ❌ WARNING: Found ${closedData.resolved_count} resolved positions (should be 0)\n`);
  }

  // Step 4: is_closed validation
  console.log('4️⃣ is_closed Logic Validation...');
  const isClosedCheck = await clickhouse.query({
    query: `
      SELECT
        countIf(is_closed = 1 AND tokens_held > 0) as invalid_closed,
        countIf(is_closed = 0 AND tokens_held = 0) as invalid_open
      FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test
    `,
    format: 'JSONEachRow'
  });
  const isClosedData = (await isClosedCheck.json())[0];

  console.log(`   Invalid closed (is_closed=1 but tokens_held>0): ${isClosedData.invalid_closed}`);
  console.log(`   Invalid open (is_closed=0 but tokens_held=0): ${isClosedData.invalid_open}`);

  if (isClosedData.invalid_closed === 0 && isClosedData.invalid_open === 0) {
    console.log(`   ✅ is_closed logic working correctly\n`);
  } else {
    console.log(`   ❌ is_closed logic has issues\n`);
  }

  // Step 5: Sample closed positions
  console.log('5️⃣ Sample Closed Positions (fully exited)...');
  const sampleClosed = await clickhouse.query({
    query: `
      SELECT
        wallet, condition_id, outcome_index,
        tokens, tokens_sold_early, tokens_held,
        cost_usd, exit_value, pnl_usd, is_closed
      FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test
      WHERE is_closed = 1 AND abs(cost_usd) >= 10
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const closedSamples = await sampleClosed.json();

  if (closedSamples.length > 0) {
    console.log(`   Found ${closedSamples.length} closed positions:`);
    closedSamples.forEach((row: any, i: number) => {
      console.log(`   ${i+1}. ${row.wallet.substring(0,10)}... | Cost: $${row.cost_usd.toFixed(2)} | Exit: $${row.exit_value.toFixed(2)} | PnL: $${row.pnl_usd.toFixed(2)}`);
    });
    console.log();
  } else {
    console.log('   No closed positions found in sample\n');
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Step 6: Extract resolved positions for same wallets
  console.log('6️⃣ Extracting resolved positions for same wallets...');

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_resolved_7d_test`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_resolved_7d_test AS
      SELECT * FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE wallet IN (
        SELECT DISTINCT wallet
        FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test
      )
    `
  });

  const resolvedResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_trade_fifo_roi_v3_mat_resolved_7d_test`,
    format: 'JSONEachRow'
  });
  const resolvedTotal = (await resolvedResult.json())[0].total;
  console.log(`   ✅ Extracted ${resolvedTotal.toLocaleString()} resolved rows\n`);

  // Step 7: Create unified test table
  console.log('7️⃣ Creating unified test table (resolved + unresolved)...');

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_7d_test`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_7d_test (
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

  // Insert resolved positions
  console.log('   Inserting resolved positions...');
  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_7d_test
      SELECT * FROM pm_trade_fifo_roi_v3_mat_resolved_7d_test
    `
  });
  console.log('   ✅ Resolved positions inserted\n');

  // Insert unresolved positions
  console.log('   Inserting unresolved positions...');
  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_7d_test
      SELECT * FROM pm_trade_fifo_roi_v3_mat_unresolved_7d_test
    `
  });
  console.log('   ✅ Unresolved positions inserted\n');

  // Step 8: Verify unified table
  console.log('8️⃣ Verifying unified table...\n');

  const unifiedResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as wallets,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        countIf(resolved_at IS NULL) as unresolved_rows,
        countIf(is_closed = 1) as closed_positions,
        countIf(is_closed = 0) as open_positions,
        uniq(tx_hash, wallet, condition_id, outcome_index) as unique_keys
      FROM pm_trade_fifo_roi_v3_mat_unified_7d_test
    `,
    format: 'JSONEachRow'
  });
  const unifiedData = (await unifiedResult.json())[0];

  console.log(`   Total rows: ${unifiedData.total_rows.toLocaleString()}`);
  console.log(`   Unique keys: ${unifiedData.unique_keys.toLocaleString()}`);
  console.log(`   Duplicates: ${(unifiedData.total_rows - unifiedData.unique_keys).toLocaleString()}`);
  console.log(`   Wallets: ${unifiedData.wallets.toLocaleString()}\n`);

  console.log(`   Resolved positions: ${unifiedData.resolved_rows.toLocaleString()}`);
  console.log(`   Unresolved positions: ${unifiedData.unresolved_rows.toLocaleString()}`);
  console.log(`   Closed positions: ${unifiedData.closed_positions.toLocaleString()}`);
  console.log(`   Open positions: ${unifiedData.open_positions.toLocaleString()}\n`);

  const expectedTotal = resolvedTotal + total;
  const actualTotal = unifiedData.total_rows;

  if (actualTotal === expectedTotal) {
    console.log(`   ✅ Row count matches: ${actualTotal.toLocaleString()} = ${resolvedTotal.toLocaleString()} + ${total.toLocaleString()}\n`);
  } else {
    console.log(`   ⚠️  Row count mismatch: ${actualTotal.toLocaleString()} != ${expectedTotal.toLocaleString()}\n`);
  }

  // Step 9: Test sample queries
  console.log('9️⃣ Testing sample queries on unified table...\n');

  // Test leaderboard query
  console.log('   Testing leaderboard query...');
  const leaderboardResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        sum(pnl_usd) as total_pnl,
        count() as total_positions,
        countIf(is_closed = 1) as closed_positions,
        countIf(resolved_at IS NOT NULL) as resolved_positions,
        countIf(resolved_at IS NULL) as unresolved_positions
      FROM pm_trade_fifo_roi_v3_mat_unified_7d_test
      GROUP BY wallet
      ORDER BY total_pnl DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const leaderboardData = await leaderboardResult.json();

  console.log(`   Top 5 wallets by PnL:`);
  leaderboardData.forEach((row: any, i: number) => {
    console.log(`     ${i+1}. ${row.wallet.substring(0,10)}... | PnL: $${row.total_pnl.toFixed(2)} | Positions: ${row.total_positions} (${row.resolved_positions} resolved, ${row.unresolved_positions} unresolved)`);
  });
  console.log();

  const finalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('═'.repeat(60));
  console.log(`✅ PHASE 0 TEST COMPLETE in ${finalTime} minutes`);
  console.log(`\n📊 Final Results:`);
  console.log(`   - Unresolved rows: ${total.toLocaleString()}`);
  console.log(`   - Resolved rows: ${resolvedTotal.toLocaleString()}`);
  console.log(`   - Unified rows: ${unifiedData.total_rows.toLocaleString()}`);
  console.log(`   - Wallets: ${unifiedData.wallets.toLocaleString()}`);
  console.log(`   - Closed: ${unifiedData.closed_positions.toLocaleString()}`);
  console.log(`   - Open: ${unifiedData.open_positions.toLocaleString()}`);

  console.log(`\n📊 Tables Created:`);
  console.log(`   - pm_trade_fifo_roi_v3_mat_unresolved_7d_test (${total.toLocaleString()} rows)`);
  console.log(`   - pm_trade_fifo_roi_v3_mat_resolved_7d_test (${resolvedTotal.toLocaleString()} rows)`);
  console.log(`   - pm_trade_fifo_roi_v3_mat_unified_7d_test (${unifiedData.total_rows.toLocaleString()} rows)`);

  if (unifiedData.total_rows === unifiedData.unique_keys &&
      actualTotal === expectedTotal &&
      closedData.resolved_count === 0 &&
      isClosedData.invalid_closed === 0 &&
      isClosedData.invalid_open === 0) {
    console.log(`\n✅ VALIDATION SUCCESSFUL - Ready for Phase 1 (full backfill)!`);
    console.log(`\n📋 Next: Run Phase 1 with ALL wallets (overnight)`);
  } else {
    console.log(`\n⚠️  REVIEW NEEDED: Check warnings above`);
  }
  console.log('═'.repeat(60));
}

rebuildUnresolved7DaysTest()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
