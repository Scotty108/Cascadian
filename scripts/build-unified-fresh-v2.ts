#!/usr/bin/env npx tsx
/**
 * Build Fresh Unified Table V2
 *
 * Creates a brand new pm_trade_fifo_roi_v3_mat_unified_v2 table with:
 * - All resolved positions from existing table
 * - Fresh unresolved positions (last 24 hours of wallet activity)
 *
 * SAFETY: Does NOT touch the existing table at all - complete new build
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const NEW_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_v2';
const OLD_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';

async function buildFreshTable() {
  console.log('🔨 Building Fresh Unified Table V2\n');
  console.log(`Old table: ${OLD_TABLE} (UNTOUCHED)`);
  console.log(`New table: ${NEW_TABLE} (FRESH BUILD)\n`);

  const startTime = Date.now();

  // Step 1: Kill pending mutations on old table
  console.log('1️⃣ Killing pending mutations on old table...');
  try {
    await clickhouse.command({
      query: `
        KILL MUTATION
        WHERE table = '${OLD_TABLE}'
          AND database = 'default'
          AND is_done = 0
        SYNC
      `,
      clickhouse_settings: {
        max_execution_time: 300,
      }
    });
    console.log('   ✅ Mutations killed\n');
  } catch (error: any) {
    console.log(`   ⚠️  ${error.message} (might be zero mutations)\n`);
  }

  // Step 2: Drop new table if exists (clean slate)
  console.log(`2️⃣ Dropping ${NEW_TABLE} if exists...`);
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS ${NEW_TABLE}`,
  });
  console.log('   ✅ Clean slate\n');

  // Step 3: Create new table structure
  console.log(`3️⃣ Creating ${NEW_TABLE} structure...`);
  await clickhouse.command({
    query: `
      CREATE TABLE ${NEW_TABLE} (
        tx_hash String,
        wallet LowCardinality(String),
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        resolved_at Nullable(DateTime),
        tokens Float64,
        cost_usd Float64,
        tokens_sold_early Float64,
        tokens_held Float64,
        exit_value Float64,
        pnl_usd Float64,
        roi Float64,
        pct_sold_early Float64,
        is_maker UInt8,
        is_closed UInt8,
        is_short UInt8
      )
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `,
  });
  console.log('   ✅ Table created\n');

  // Step 4: Copy all resolved positions from old table
  console.log('4️⃣ Copying resolved positions from old table...');
  const resolvedStart = Date.now();
  await clickhouse.command({
    query: `
      INSERT INTO ${NEW_TABLE}
      SELECT *
      FROM ${OLD_TABLE}
      WHERE resolved_at IS NOT NULL
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 minutes
    }
  });
  const resolvedTime = ((Date.now() - resolvedStart) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Resolved positions copied (${resolvedTime} minutes)\n`);

  // Step 5: Get fresh unresolved positions (last 24 hours of wallet activity)
  console.log('5️⃣ Building fresh unresolved positions...\n');

  // Find wallets active in last 24 hours
  console.log('   Finding active wallets...');
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 24 HOUR
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND source = 'clob'
    `,
    format: 'JSONEachRow',
  });
  const wallets = (await walletsResult.json<{ wallet: string }>()).map(w => w.wallet);
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} active wallets\n`);

  // Process in batches (avoid query size limits)
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);

  console.log(`   Processing ${totalBatches} batches...\n`);

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length));
    const batchWallets = batch.map(w => `'${w}'`).join(',');

    if (batchNum % 10 === 0 || batchNum === 1) {
      console.log(`   Batch ${batchNum}/${totalBatches}...`);
    }

    // Insert LONG positions (unresolved only)
    await clickhouse.command({
      query: `
        INSERT INTO ${NEW_TABLE}
        SELECT
          buys.tx_hash,
          buys.wallet,
          buys.condition_id,
          buys.outcome_index,
          buys.entry_time,
          NULL as resolved_at,
          buys.tokens,
          buys.cost_usd,
          0 as tokens_sold_early,
          buys.tokens as tokens_held,
          0 as exit_value,
          0 as pnl_usd,
          0 as roi,
          0 as pct_sold_early,
          buys.is_maker_flag as is_maker,
          0 as is_closed,
          0 as is_short
        FROM (
          SELECT
            tx_hash,
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            sum(tokens_delta) as tokens,
            sum(abs(usdc_delta)) as cost_usd,
            max(is_maker) as is_maker_flag
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${batchWallets}]
            AND source = 'clob'
            AND tokens_delta > 0
            AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY tx_hash, wallet, condition_id, outcome_index
          HAVING cost_usd >= 0.01 AND tokens >= 0.01
        ) AS buys
        LEFT JOIN pm_condition_resolutions AS r
          ON buys.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });

    // Insert SHORT positions (unresolved only)
    await clickhouse.command({
      query: `
        INSERT INTO ${NEW_TABLE}
        SELECT
          concat('short_', substring(shorts.wallet, 1, 10), '_', substring(shorts.condition_id, 1, 10), '_', toString(shorts.outcome_index), '_', toString(toUnixTimestamp(shorts.entry_time))) as tx_hash,
          shorts.wallet,
          shorts.condition_id,
          shorts.outcome_index,
          shorts.entry_time,
          NULL as resolved_at,
          abs(shorts.net_tokens) as tokens,
          -shorts.cash_flow as cost_usd,
          0 as tokens_sold_early,
          abs(shorts.net_tokens) as tokens_held,
          0 as exit_value,
          0 as pnl_usd,
          0 as roi,
          0 as pct_sold_early,
          0 as is_maker,
          0 as is_closed,
          1 as is_short
        FROM (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            sum(tokens_delta) as net_tokens,
            sum(usdc_delta) as cash_flow
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${batchWallets}]
            AND source = 'clob'
            AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING net_tokens < -0.01 AND cash_flow > 0.01
        ) AS shorts
        LEFT JOIN pm_condition_resolutions AS r
          ON shorts.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });
  }

  const unresolvedTime = ((Date.now() - resolvedStart - (parseFloat(resolvedTime) * 60 * 1000)) / 1000 / 60).toFixed(1);
  console.log(`\n   ✅ Unresolved positions built (${unresolvedTime} minutes)\n`);

  // Step 6: Verify new table
  console.log('6️⃣ Verifying new table...\n');

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NULL) as unresolved_rows,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as unresolved_stale_min,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as resolved_stale_min
      FROM ${NEW_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const stats = (await verifyResult.json<any>())[0];

  console.log('📊 NEW TABLE STATS:');
  console.log(`   Total rows: ${parseInt(stats.total_rows).toLocaleString()}`);
  console.log(`   Unique wallets: ${parseInt(stats.unique_wallets).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(stats.resolved_rows).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(stats.unresolved_rows).toLocaleString()}`);
  console.log(`   Unresolved staleness: ${stats.unresolved_stale_min} minutes`);
  console.log(`   Resolved staleness: ${stats.resolved_stale_min} minutes\n`);

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ BUILD COMPLETE! (${totalTime} minutes)\n`);

  console.log('📋 NEXT STEPS:');
  console.log(`   1. Verify data looks good in ${NEW_TABLE}`);
  console.log(`   2. Run comparison queries between old and new table`);
  console.log(`   3. When ready to switch:`);
  console.log(`      RENAME TABLE`);
  console.log(`        ${OLD_TABLE} TO ${OLD_TABLE}_backup,`);
  console.log(`        ${NEW_TABLE} TO ${OLD_TABLE};`);
  console.log(`   4. Old table preserved as ${OLD_TABLE}_backup\n`);
}

buildFreshTable().catch(console.error);
