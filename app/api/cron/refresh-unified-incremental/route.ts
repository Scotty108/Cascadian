/**
 * Cron: Refresh Unified FIFO Table (Incremental)
 *
 * Updates pm_trade_fifo_roi_v3_mat_unified with:
 * 1. New unresolved positions from last 48 hours of active wallets
 * 2. Newly resolved positions
 *
 * Schedule: Daily at 5:00 AM UTC (after fix-unmapped-tokens at 4:00 AM)
 * Timeout: 20 minutes (sufficient for daily delta)
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const maxDuration = 600; // 10 minutes (Vercel Pro limit: 800s)
export const dynamic = 'force-dynamic';
export const revalidate = 0; // Force no caching

const LOOKBACK_HOURS = 24; // 24 hours to cover staleness gap with buffer
const BATCH_SIZE = 500;

interface WalletInfo {
  wallet: string;
  first_trade_time: number;
  last_trade_time: number;
}

async function getActiveWallets(client: any): Promise<WalletInfo[]> {
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
        AND trader_wallet != '0x0000000000000000000000000000000000000000'
      GROUP BY event_id
    )
    SELECT
      wallet,
      toUnixTimestamp(min(first_time)) as first_trade_time,
      toUnixTimestamp(max(last_time)) as last_trade_time
    FROM deduped_events
    GROUP BY wallet
  `;

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  return await result.json() as WalletInfo[];
}

async function processUnresolvedBatch(
  client: any,
  wallets: WalletInfo[]
): Promise<void> {
  const walletList = wallets.map((w) => `'${w.wallet}'`).join(', ');

  // Clean up any existing temp tables first
  await client.command({ query: 'DROP TABLE IF EXISTS temp_active_wallets_cron' });
  await client.command({ query: 'DROP TABLE IF EXISTS temp_unresolved_conditions_cron' });

  // Create temp tables (use regular Memory tables, not TEMPORARY, for serverless compatibility)
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS temp_active_wallets_cron (
        wallet String,
        first_trade_time UInt32,
        last_trade_time UInt32
      ) ENGINE = Memory
    `,
  });

  const walletValues = wallets
    .map((w) => `('${w.wallet}', ${w.first_trade_time}, ${w.last_trade_time})`)
    .join(',');

  await client.command({
    query: `INSERT INTO temp_active_wallets_cron VALUES ${walletValues}`,
  });

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS temp_unresolved_conditions_cron (
        condition_id String,
        outcome_index Int64
      ) ENGINE = Memory
    `,
  });

  await client.command({
    query: `
      INSERT INTO temp_unresolved_conditions_cron
      SELECT DISTINCT
        condition_id,
        outcome_index
      FROM (
        SELECT
          fill_id,
          any(condition_id) as condition_id,
          any(outcome_index) as outcome_index
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

  // Process LONG positions (with anti-join to prevent duplicates)
  const longQuery = `
    INSERT INTO pm_trade_fifo_roi_v3_mat_unified
    SELECT
      new.tx_hash,
      new.wallet,
      new.condition_id,
      new.outcome_index,
      new.entry_time,
      NULL as resolved_at,
      new.tokens,
      new.cost_usd,
      0 as tokens_sold_early,
      new.tokens as tokens_held,
      0 as exit_value,
      0 as pnl_usd,
      0 as roi,
      0 as pct_sold_early,
      new.is_maker_flag as is_maker,
      0 as is_closed,
      0 as is_short
    FROM (
      SELECT
        fills._tx_hash as tx_hash,
        fills._wallet as wallet,
        fills._condition_id as condition_id,
        fills._outcome_index as outcome_index,
        min(fills._event_time) as entry_time,
        sum(fills._tokens_delta) as tokens,
        sum(abs(fills._usdc_delta)) as cost_usd,
        max(fills._is_maker) as is_maker_flag
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
      ) AS fills
      INNER JOIN temp_unresolved_conditions_cron uc
        ON fills._condition_id = uc.condition_id
        AND fills._outcome_index = uc.outcome_index
      WHERE fills._source = 'clob'
        AND fills._tokens_delta > 0
        AND fills._wallet != '0x0000000000000000000000000000000000000000'
        AND NOT (fills._is_self_fill = 1 AND fills._is_maker = 1)
      GROUP BY fills._tx_hash, fills._wallet, fills._condition_id, fills._outcome_index
      HAVING cost_usd >= 0.01
        AND tokens >= 0.01
    ) AS new
    LEFT JOIN pm_trade_fifo_roi_v3_mat_unified existing
      ON new.tx_hash = existing.tx_hash
      AND new.wallet = existing.wallet
      AND new.condition_id = existing.condition_id
      AND new.outcome_index = existing.outcome_index
    WHERE existing.tx_hash IS NULL
  `;

  await client.command({
    query: longQuery,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Process SHORT positions (with anti-join to prevent duplicates)
  const shortQuery = `
    INSERT INTO pm_trade_fifo_roi_v3_mat_unified
    SELECT
      new.tx_hash,
      new.wallet,
      new.condition_id,
      new.outcome_index,
      new.entry_time,
      NULL as resolved_at,
      new.tokens,
      new.cost_usd,
      0 as tokens_sold_early,
      new.tokens as tokens_held,
      0 as exit_value,
      0 as pnl_usd,
      0 as roi,
      0 as pct_sold_early,
      0 as is_maker,
      0 as is_closed,
      1 as is_short
    FROM (
      SELECT
        concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index), '_', toString(toUnixTimestamp(entry_time))) as tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        abs(net_tokens) as tokens,
        -cash_flow as cost_usd
      FROM (
        SELECT
          fills._wallet as wallet,
          fills._condition_id as condition_id,
          fills._outcome_index as outcome_index,
          min(fills._event_time) as entry_time,
          sum(fills._tokens_delta) as net_tokens,
          sum(fills._usdc_delta) as cash_flow
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
          WHERE wallet IN [${walletList}]
            AND source = 'clob'
          GROUP BY fill_id
        ) AS fills
        INNER JOIN temp_unresolved_conditions_cron uc
          ON fills._condition_id = uc.condition_id
          AND fills._outcome_index = uc.outcome_index
        WHERE fills._source = 'clob'
          AND fills._wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (fills._is_self_fill = 1 AND fills._is_maker = 1)
        GROUP BY fills._wallet, fills._condition_id, fills._outcome_index
        HAVING net_tokens < -0.01
          AND cash_flow > 0.01
      )
    ) AS new
    LEFT JOIN pm_trade_fifo_roi_v3_mat_unified existing
      ON new.wallet = existing.wallet
      AND new.condition_id = existing.condition_id
      AND new.outcome_index = existing.outcome_index
      AND existing.is_short = 1
    WHERE existing.wallet IS NULL
  `;

  await client.command({
    query: shortQuery,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Clean up temp tables
  await client.command({ query: 'DROP TABLE IF EXISTS temp_active_wallets_cron' });
  await client.command({ query: 'DROP TABLE IF EXISTS temp_unresolved_conditions_cron' });
}

async function updateResolvedPositions(client: any): Promise<number> {
  // Step 1: Identify positions to update (from v3, not deduped)
  const identifyResult = await client.query({
    query: `
      SELECT count() as positions_to_update
      FROM pm_trade_fifo_roi_v3 v
      INNER JOIN pm_trade_fifo_roi_v3_mat_unified u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND v.resolved_at IS NOT NULL
        AND u.resolved_at IS NULL
    `,
    format: 'JSONEachRow',
  });
  const result = await identifyResult.json() as any;
  const positions_to_update = result[0]?.positions_to_update || 0;

  if (positions_to_update === 0) {
    return 0;
  }

  // Step 2: Create temp table with keys to update
  await client.command({ query: 'DROP TABLE IF EXISTS temp_resolved_keys_incremental' });

  await client.command({
    query: `
      CREATE TABLE temp_resolved_keys_incremental (
        tx_hash String,
        wallet String,
        condition_id String,
        outcome_index UInt8
      ) ENGINE = Memory
    `,
  });

  await client.command({
    query: `
      INSERT INTO temp_resolved_keys_incremental
      SELECT DISTINCT v.tx_hash, v.wallet, v.condition_id, v.outcome_index
      FROM pm_trade_fifo_roi_v3 v
      INNER JOIN pm_trade_fifo_roi_v3_mat_unified u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND v.resolved_at IS NOT NULL
        AND u.resolved_at IS NULL
    `,
  });

  // Step 3: Delete old unresolved rows
  await client.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE (tx_hash, wallet, condition_id, outcome_index) IN (
        SELECT tx_hash, wallet, condition_id, outcome_index
        FROM temp_resolved_keys_incremental
      )
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Wait for DELETE mutation to complete before inserting
  // This prevents race condition that creates duplicates
  let mutationDone = false;
  let attempts = 0;
  while (!mutationDone && attempts < 60) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const mutationCheck = await client.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
          AND is_done = 0
      `,
      format: 'JSONEachRow',
    });
    const pending = ((await mutationCheck.json()) as any)[0]?.pending || 0;
    mutationDone = pending === 0;
    attempts++;
  }

  // Step 4: Insert new resolved rows from v3 (not deduped)
  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        v.tx_hash,
        v.wallet,
        v.condition_id,
        v.outcome_index,
        v.entry_time,
        v.resolved_at,
        v.cost_usd,
        v.tokens,
        v.tokens_sold_early,
        v.tokens_held,
        v.exit_value,
        v.pnl_usd,
        v.roi,
        v.pct_sold_early,
        v.is_maker,
        CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
        v.is_short
      FROM pm_trade_fifo_roi_v3 v
      INNER JOIN temp_resolved_keys_incremental t
        ON v.tx_hash = t.tx_hash
        AND v.wallet = t.wallet
        AND v.condition_id = t.condition_id
        AND v.outcome_index = t.outcome_index
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Step 5: Cleanup temp table
  await client.command({
    query: `DROP TABLE IF EXISTS temp_resolved_keys_incremental`,
  });

  return positions_to_update;
}

async function deduplicateTable(client: any): Promise<void> {
  await client.command({
    query: `OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL`,
    clickhouse_settings: { max_execution_time: 600 },
  });
}

async function refreshAllUnresolvedConditions(client: any): Promise<number> {
  // Get ALL unresolved conditions (not just active wallets)
  const conditionsResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND condition_id NOT IN (
          SELECT condition_id
          FROM pm_condition_resolutions
          WHERE is_deleted = 0
            AND payout_numerators != ''
        )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const conditions = ((await conditionsResult.json()) as { condition_id: string }[]).map((r) => r.condition_id);

  if (conditions.length === 0) {
    return 0;
  }

  // Process in batches (LONG positions only - most common)
  const UNRESOLVED_BATCH_SIZE = 200;
  for (let i = 0; i < conditions.length; i += UNRESOLVED_BATCH_SIZE) {
    const batch = conditions.slice(i, i + UNRESOLVED_BATCH_SIZE);
    const conditionList = batch.map((id) => `'${id}'`).join(',');

    // Insert LONG positions with anti-join to avoid duplicates
    await client.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          new.tx_hash, new.wallet, new.condition_id, new.outcome_index,
          new.entry_time, NULL as resolved_at,
          new.tokens, new.cost_usd,
          0 as tokens_sold_early, new.tokens as tokens_held,
          0 as exit_value, 0 as pnl_usd, 0 as roi, 0 as pct_sold_early,
          new.is_maker_flag as is_maker, 0 as is_closed, 0 as is_short
        FROM (
          SELECT
            _tx_hash as tx_hash, _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
            min(_event_time) as entry_time, sum(_tokens_delta) as tokens, sum(abs(_usdc_delta)) as cost_usd,
            max(_is_maker) as is_maker_flag
          FROM (
            SELECT fill_id, any(tx_hash) as _tx_hash, any(event_time) as _event_time,
              any(wallet) as _wallet, any(condition_id) as _condition_id, any(outcome_index) as _outcome_index,
              any(tokens_delta) as _tokens_delta, any(usdc_delta) as _usdc_delta,
              any(is_maker) as _is_maker, any(is_self_fill) as _is_self_fill
            FROM pm_canonical_fills_v4
            WHERE condition_id IN (${conditionList}) AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE _tokens_delta > 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (_is_self_fill = 1 AND _is_maker = 1)
          GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
          HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
        ) AS new
        LEFT JOIN pm_trade_fifo_roi_v3_mat_unified existing
          ON new.tx_hash = existing.tx_hash
          AND new.wallet = existing.wallet
          AND new.condition_id = existing.condition_id
          AND new.outcome_index = existing.outcome_index
        WHERE existing.tx_hash IS NULL
      `,
      clickhouse_settings: { max_execution_time: 300 },
    });
  }

  return conditions.length;
}

async function syncNewResolvedPositions(client: any): Promise<number> {
  // Get latest resolved_at in unified table
  const latestResult = await client.query({
    query: `SELECT max(resolved_at) as latest FROM pm_trade_fifo_roi_v3_mat_unified WHERE resolved_at IS NOT NULL`,
    format: 'JSONEachRow',
  });
  const latest = ((await latestResult.json()) as any)[0]?.latest;

  if (!latest) {
    return 0;
  }

  // Get distinct conditions that need syncing
  const conditionsResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at > '${latest}'
      LIMIT 5000
    `,
    format: 'JSONEachRow',
  });
  const conditions = ((await conditionsResult.json()) as { condition_id: string }[]).map((r) => r.condition_id);

  if (conditions.length === 0) {
    return 0;
  }

  // Process in batches
  const SYNC_BATCH_SIZE = 500;
  let synced = 0;

  for (let i = 0; i < conditions.length; i += SYNC_BATCH_SIZE) {
    const batch = conditions.slice(i, i + SYNC_BATCH_SIZE);
    const conditionList = batch.map((id) => `'${id}'`).join(',');

    await client.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          v.tx_hash, v.wallet, v.condition_id, v.outcome_index,
          v.entry_time, v.resolved_at, v.tokens, v.cost_usd,
          v.tokens_sold_early, v.tokens_held, v.exit_value,
          v.pnl_usd, v.roi, v.pct_sold_early,
          v.is_maker, v.is_closed, v.is_short
        FROM pm_trade_fifo_roi_v3 v
        LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
          ON v.tx_hash = u.tx_hash
          AND v.wallet = u.wallet
          AND v.condition_id = u.condition_id
          AND v.outcome_index = u.outcome_index
        WHERE v.condition_id IN (${conditionList})
          AND v.resolved_at > '${latest}'
          AND u.tx_hash IS NULL
      `,
      clickhouse_settings: { max_execution_time: 300 },
    });

    synced += batch.length;
  }

  return synced;
}

async function getTableStats(client: any) {
  const result = await client.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NULL) as unresolved,
        countIf(resolved_at IS NOT NULL) as resolved,
        max(entry_time) as latest_entry,
        max(resolved_at) as latest_resolution
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });

  const stats = await result.json() as any;
  return stats[0];
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronRequest(request, 'refresh-unified-incremental');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const client = getClickHouseClient();

    console.log('[Cron] Starting incremental unified table refresh');

    // Step 1: Get active wallets
    const activeWallets = await getActiveWallets(client);
    console.log(`[Cron] Found ${activeWallets.length} active wallets`);

    if (activeWallets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active wallets to process',
        activeWallets: 0,
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        timestamp: new Date().toISOString(),
      });
    }

    // Step 2: Process in batches
    let processed = 0;
    for (let i = 0; i < activeWallets.length; i += BATCH_SIZE) {
      const batch = activeWallets.slice(i, Math.min(i + BATCH_SIZE, activeWallets.length));
      await processUnresolvedBatch(client, batch);
      processed += batch.length;
      console.log(`[Cron] Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(activeWallets.length / BATCH_SIZE)}`);
    }

    // Step 3: Update resolved positions (existing unresolved → resolved)
    await updateResolvedPositions(client);
    console.log('[Cron] Updated resolved positions');

    // Step 4: Sync new resolved positions from pm_trade_fifo_roi_v3
    const syncedConditions = await syncNewResolvedPositions(client);
    console.log(`[Cron] Synced ${syncedConditions} new resolved conditions`);

    // Step 5: Refresh ALL unresolved conditions (not just active wallets)
    const unresolvedRefreshed = await refreshAllUnresolvedConditions(client);
    console.log(`[Cron] Refreshed ${unresolvedRefreshed} unresolved conditions`);

    // Step 6: Deduplicate
    await deduplicateTable(client);
    console.log('[Cron] Optimized table');

    // Step 5: Get stats
    const stats = await getTableStats(client);

    const durationMs = Date.now() - startTime;

    await logCronExecution({
      cron_name: 'refresh-unified-incremental',
      status: 'success',
      duration_ms: durationMs,
      details: {
        activeWallets: activeWallets.length,
        processed,
        totalRows: stats.total_rows,
        uniqueWallets: stats.unique_wallets,
      },
    });

    return NextResponse.json({
      success: true,
      activeWallets: activeWallets.length,
      processed,
      stats: {
        totalRows: stats.total_rows,
        uniqueWallets: stats.unique_wallets,
        unresolved: stats.unresolved,
        resolved: stats.resolved,
        latestEntry: stats.latest_entry,
        latestResolution: stats.latest_resolution,
      },
      duration: `${(durationMs / 1000).toFixed(1)}s`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[Cron] Unified incremental refresh failed:', error);

    await logCronExecution({
      cron_name: 'refresh-unified-incremental',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message,
    });

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
