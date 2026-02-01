/**
 * Incremental Unified Table Refresh
 *
 * Updates pm_trade_fifo_roi_v3_mat_unified with:
 * 1. New unresolved positions from last 48 hours of active wallets
 * 2. Newly resolved positions
 *
 * Designed to run daily (fast, no full rebuild needed).
 *
 * Runtime: ~10-15 minutes for daily delta
 */

import dotenv from 'dotenv';
import { join } from 'path';
import { getClickHouseClient } from '../lib/clickhouse/client';

// Load .env.local explicitly
dotenv.config({ path: join(process.cwd(), '.env.local') });

const LOOKBACK_HOURS = 48; // Process wallets active in last 48 hours
const BATCH_SIZE = 500; // Wallets per batch

interface WalletInfo {
  wallet: string;
  first_trade_time: number;
  last_trade_time: number;
}

async function getActiveWallets(client: any): Promise<WalletInfo[]> {
  console.log(`\n📊 Finding wallets with activity in last ${LOOKBACK_HOURS} hours...`);

  const query = `
    WITH deduped_events AS (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        min(trade_time) as first_time,
        max(trade_time) as last_time
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
      GROUP BY event_id
    )
    SELECT
      wallet,
      toUnixTimestamp(min(first_time)) as first_trade_time,
      toUnixTimestamp(max(last_time)) as last_trade_time
    FROM deduped_events
    WHERE wallet != '0x0000000000000000000000000000000000000000'
    GROUP BY wallet
  `;

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  const wallets = await result.json<WalletInfo>();
  console.log(`   ✅ Found ${wallets.length} active wallets`);

  return wallets;
}

async function processUnresolvedPositions(
  client: any,
  wallets: WalletInfo[]
): Promise<number> {
  if (wallets.length === 0) return 0;

  console.log(`\n🔨 Processing unresolved positions for ${wallets.length} wallets...`);

  let totalInserted = 0;

  // Process in batches
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length));
    const walletList = batch.map((w) => `'${w.wallet}'`).join(', ');

    console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(wallets.length / BATCH_SIZE)}: ${batch.length} wallets`);

    // Step 1: Create temp table for active wallets (this batch)
    await client.command({
      query: `
        CREATE TEMPORARY TABLE IF NOT EXISTS temp_active_wallets_incremental (
          wallet String,
          first_trade_time UInt32,
          last_trade_time UInt32
        ) ENGINE = Memory
      `,
    });

    // Insert batch wallets
    const walletValues = batch
      .map((w) => `('${w.wallet}', ${w.first_trade_time}, ${w.last_trade_time})`)
      .join(',');

    await client.command({
      query: `INSERT INTO temp_active_wallets_incremental VALUES ${walletValues}`,
    });

    // Step 2: Create temp table for unresolved conditions
    await client.command({
      query: `
        CREATE TEMPORARY TABLE IF NOT EXISTS temp_unresolved_conditions_incremental (
          condition_id String,
          outcome_index Int64
        ) ENGINE = Memory
      `,
    });

    await client.command({
      query: `
        INSERT INTO temp_unresolved_conditions_incremental
        SELECT DISTINCT
          f.condition_id,
          f.outcome_index
        FROM (
          SELECT
            fill_id,
            any(condition_id) as condition_id,
            any(outcome_index) as outcome_index,
            any(wallet) as wallet
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${walletList}]
            AND source = 'clob'
          GROUP BY fill_id
        ) f
        LEFT JOIN pm_condition_resolutions r
          ON f.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
    });

    // Step 3: Process LONG positions (BUY events with tokens_delta > 0)
    const longQuery = `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        NULL as resolved_at,
        tokens,
        cost_usd,
        0 as tokens_sold_early,
        tokens as tokens_held,
        0 as exit_value,
        0 as pnl_usd,
        0 as roi,
        0 as pct_sold_early,
        is_maker_flag as is_maker,
        0 as is_closed,
        0 as is_short
      FROM (
        SELECT
          _tx_hash as tx_hash,
          _wallet as wallet,
          _condition_id as condition_id,
          _outcome_index as outcome_index,
          min(_event_time) as entry_time,
          sum(_tokens_delta) as tokens,
          sum(abs(_usdc_delta)) as cost_usd,
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
          WHERE wallet IN [${walletList}]
            AND source = 'clob'
          GROUP BY fill_id
        )
        INNER JOIN temp_unresolved_conditions_incremental uc
          ON _condition_id = uc.condition_id
          AND _outcome_index = uc.outcome_index
        WHERE _source = 'clob'
          AND _tokens_delta > 0
          AND _wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (_is_self_fill = 1 AND _is_maker = 1)
        GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
        HAVING cost_usd >= 0.01
          AND tokens >= 0.01
      )
    `;

    await client.command({
      query: longQuery,
      clickhouse_settings: {
        max_execution_time: 300,
      },
    });

    // Step 4: Process SHORT positions (net negative tokens)
    const shortQuery = `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index), '_', toString(toUnixTimestamp(entry_time))) as tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        NULL as resolved_at,
        abs(net_tokens) as tokens,
        -cash_flow as cost_usd,
        0 as tokens_sold_early,
        abs(net_tokens) as tokens_held,
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
        FROM (
          SELECT
            fill_id,
            any(event_time) as event_time,
            any(wallet) as wallet,
            any(condition_id) as condition_id,
            any(outcome_index) as outcome_index,
            any(tokens_delta) as tokens_delta,
            any(usdc_delta) as usdc_delta,
            any(source) as source,
            any(is_self_fill) as is_self_fill,
            any(is_maker) as is_maker
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${walletList}]
            AND source = 'clob'
          GROUP BY fill_id
        )
        INNER JOIN temp_unresolved_conditions_incremental uc
          ON condition_id = uc.condition_id
          AND outcome_index = uc.outcome_index
        WHERE source = 'clob'
          AND wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (is_self_fill = 1 AND is_maker = 1)
        GROUP BY wallet, condition_id, outcome_index
        HAVING net_tokens < -0.01
          AND cash_flow > 0.01
      )
    `;

    await client.command({
      query: shortQuery,
      clickhouse_settings: {
        max_execution_time: 300,
      },
    });

    // Clean up temp tables
    await client.command({ query: 'DROP TABLE IF EXISTS temp_active_wallets_incremental' });
    await client.command({ query: 'DROP TABLE IF EXISTS temp_unresolved_conditions_incremental' });

    totalInserted += batch.length;
    console.log(`   ✅ Processed batch ${Math.floor(i / BATCH_SIZE) + 1}`);
  }

  return totalInserted;
}

async function updateResolvedPositions(client: any): Promise<number> {
  console.log(`\n🔄 Updating resolved positions...`);

  // Find positions that were unresolved but are now resolved
  const query = `
    WITH newly_resolved AS (
      SELECT DISTINCT
        u.wallet,
        u.condition_id,
        u.outcome_index
      FROM pm_trade_fifo_roi_v3_mat_unified u
      INNER JOIN pm_condition_resolutions r
        ON u.condition_id = r.condition_id
      WHERE u.resolved_at IS NULL
        AND r.is_deleted = 0
        AND r.payout_numerators != ''
        AND r.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
    )
    SELECT count() as count
    FROM newly_resolved
  `;

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ count: number }>();
  const count = rows[0]?.count || 0;

  if (count === 0) {
    console.log('   ℹ️  No newly resolved positions to update');
    return 0;
  }

  console.log(`   Found ${count} positions that need resolution updates`);

  // For ClickHouse, we can't UPDATE directly
  // Instead, we need to INSERT resolved versions from pm_trade_fifo_roi_v3_deduped
  // The SharedMergeTree will handle deduplication on next merge

  const insertQuery = `
    INSERT INTO pm_trade_fifo_roi_v3_mat_unified
    SELECT
      d.tx_hash,
      d.wallet,
      d.condition_id,
      d.outcome_index,
      d.entry_time,
      d.resolved_at,
      d.tokens,
      d.cost_usd,
      d.tokens_sold_early,
      d.tokens_held,
      d.exit_value,
      d.pnl_usd,
      d.roi,
      d.pct_sold_early,
      d.is_maker,
      d.is_closed,
      d.is_short
    FROM pm_trade_fifo_roi_v3_deduped d
    INNER JOIN pm_condition_resolutions r
      ON d.condition_id = r.condition_id
    WHERE r.is_deleted = 0
      AND r.payout_numerators != ''
      AND r.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
      AND (d.wallet, d.condition_id, d.outcome_index) IN (
        SELECT wallet, condition_id, outcome_index
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE resolved_at IS NULL
      )
  `;

  await client.command({
    query: insertQuery,
    clickhouse_settings: {
      max_execution_time: 300,
    },
  });

  console.log(`   ✅ Inserted ${count} resolved position updates`);
  return count;
}

async function deduplicateTable(client: any): Promise<void> {
  console.log(`\n🧹 Forcing table optimization to deduplicate...`);

  // Force merge to deduplicate (SharedMergeTree doesn't auto-dedupe on SELECT)
  await client.command({
    query: `OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL`,
    clickhouse_settings: {
      max_execution_time: 600,
    },
  });

  console.log(`   ✅ Optimization complete`);
}

async function getTableStats(client: any): Promise<void> {
  console.log(`\n📊 Table Statistics:`);

  const queries = [
    {
      label: 'Total rows',
      query: `SELECT formatReadableQuantity(count()) as count FROM pm_trade_fifo_roi_v3_mat_unified`,
    },
    {
      label: 'Unique wallets',
      query: `SELECT formatReadableQuantity(uniq(wallet)) as count FROM pm_trade_fifo_roi_v3_mat_unified`,
    },
    {
      label: 'Unresolved positions',
      query: `SELECT formatReadableQuantity(countIf(resolved_at IS NULL)) as count FROM pm_trade_fifo_roi_v3_mat_unified`,
    },
    {
      label: 'Resolved positions',
      query: `SELECT formatReadableQuantity(countIf(resolved_at IS NOT NULL)) as count FROM pm_trade_fifo_roi_v3_mat_unified`,
    },
    {
      label: 'Latest entry',
      query: `SELECT toString(max(entry_time)) as value FROM pm_trade_fifo_roi_v3_mat_unified`,
    },
    {
      label: 'Latest resolution',
      query: `SELECT toString(max(resolved_at)) as value FROM pm_trade_fifo_roi_v3_mat_unified WHERE resolved_at IS NOT NULL`,
    },
  ];

  for (const q of queries) {
    const result = await client.query({
      query: q.query,
      format: 'JSONEachRow',
    });
    const rows = await result.json<any>();
    const value = rows[0]?.count || rows[0]?.value || 'N/A';
    console.log(`   ${q.label}: ${value}`);
  }
}

async function main() {
  console.log('🔄 INCREMENTAL UNIFIED TABLE REFRESH');
  console.log('='.repeat(70));

  const startTime = Date.now();
  const client = getClickHouseClient();

  try {
    // Step 1: Get active wallets
    const activeWallets = await getActiveWallets(client);

    if (activeWallets.length === 0) {
      console.log('\n✅ No active wallets to process');
      return;
    }

    // Step 2: Process unresolved positions
    await processUnresolvedPositions(client, activeWallets);

    // Step 3: Update resolved positions
    await updateResolvedPositions(client);

    // Step 4: Deduplicate
    await deduplicateTable(client);

    // Step 5: Show stats
    await getTableStats(client);

    const duration = (Date.now() - startTime) / 1000 / 60;
    console.log('\n' + '='.repeat(70));
    console.log(`✅ INCREMENTAL REFRESH COMPLETE in ${duration.toFixed(1)} minutes`);
    console.log('='.repeat(70));
  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  }
}

main();
