/**
 * Cron: Sync Position Fact Table (Incremental)
 *
 * Incrementally builds pm_wallet_position_fact_v1 from pm_trader_events_dedup_v2_tbl.
 * Uses watermark-based processing to avoid reprocessing historical data.
 *
 * Source: pm_trader_events_dedup_v2_tbl (kept fresh by sync-clob-dedup cron)
 * Target: pm_wallet_position_fact_v1 (one row per wallet/condition/outcome)
 *
 * Processing:
 * 1. Read watermark from pm_sync_state_v1
 * 2. Process next SLICE_HOURS of data
 * 3. Aggregate trades to positions
 * 4. Insert/replace into fact table (ReplacingMergeTree handles dedup)
 * 5. Advance watermark
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Every 15 minutes (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

// Process 1 hour of data per run (adjust based on volume)
const SLICE_HOURS = 1;
// Minimum gap before syncing (avoid unnecessary work)
const MIN_GAP_SECONDS = 60;

interface SyncResult {
  success: boolean;
  skipped: boolean;
  watermarkBefore: string;
  watermarkAfter: string;
  sourceLatest: string;
  positionsUpserted: number;
  walletsAffected: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!cronSecret && !isProduction) {
    console.warn('[sync-position-fact] CRON_SECRET not set (dev mode) - allowing request');
    return true;
  }

  if (!cronSecret && isProduction) {
    console.error('[sync-position-fact] CRON_SECRET not set in production - rejecting');
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const url = new URL(request.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam === cronSecret) {
    return true;
  }

  return false;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Step 1: Get current watermark
    const watermarkResult = await clickhouse.query({
      query: `
        SELECT watermark_time, rows_processed
        FROM pm_sync_state_v1
        WHERE table_name = 'pm_wallet_position_fact_v1'
        ORDER BY last_sync_at DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const watermarkRow = ((await watermarkResult.json()) as any[])[0];
    const watermarkBefore = watermarkRow?.watermark_time || '2022-01-01 00:00:00';

    console.log(`[sync-position-fact] Watermark: ${watermarkBefore}`);

    // Step 2: Get latest time in source table
    const sourceLatestResult = await clickhouse.query({
      query: `SELECT max(trade_time) as latest FROM pm_trader_events_dedup_v2_tbl`,
      format: 'JSONEachRow',
    });
    const sourceLatest = ((await sourceLatestResult.json()) as any[])[0]?.latest as string;

    console.log(`[sync-position-fact] Source latest: ${sourceLatest}`);

    // Step 3: Check if sync is needed
    const watermarkMs = new Date(watermarkBefore + 'Z').getTime();
    const sourceLatestMs = new Date(sourceLatest + 'Z').getTime();
    const gapSeconds = (sourceLatestMs - watermarkMs) / 1000;

    if (gapSeconds <= MIN_GAP_SECONDS) {
      console.log(`[sync-position-fact] Gap is ${gapSeconds}s <= ${MIN_GAP_SECONDS}s, skipping`);

      const result: SyncResult = {
        success: true,
        skipped: true,
        watermarkBefore,
        watermarkAfter: watermarkBefore,
        sourceLatest,
        positionsUpserted: 0,
        walletsAffected: 0,
        durationMs: Date.now() - startTime,
      };

      return NextResponse.json(result);
    }

    // Step 4: Calculate slice window
    const sliceEndMs = Math.min(watermarkMs + SLICE_HOURS * 3600 * 1000, sourceLatestMs);
    const sliceEnd = new Date(sliceEndMs).toISOString().replace('T', ' ').slice(0, 19);

    console.log(`[sync-position-fact] Processing: ${watermarkBefore} -> ${sliceEnd}`);

    // Step 5: Aggregate trades to positions and insert
    // This query:
    // - Joins dedup table with token map to get condition_id
    // - Joins with resolutions to get payout_norm
    // - Aggregates by wallet/condition/outcome
    // - Computes cash_flow, shares, trade_count
    const insertQuery = `
      INSERT INTO pm_wallet_position_fact_v1
        (wallet, condition_id, outcome_index, cash_flow_usd, final_shares, trade_count, first_trade_at, last_trade_at, payout_norm, is_resolved)
      WITH
        trades_in_slice AS (
          SELECT
            t.trader_wallet AS wallet,
            m.condition_id,
            m.outcome_index,
            CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END / 1000000.0 AS usdc_delta,
            CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END / 1000000.0 AS token_delta,
            t.trade_time
          FROM pm_trader_events_dedup_v2_tbl t
          INNER JOIN pm_token_to_condition_map_v4 m
            ON toString(t.token_id) = toString(m.token_id_dec)
          WHERE t.trade_time > toDateTime('${watermarkBefore}', 'UTC')
            AND t.trade_time <= toDateTime('${sliceEnd}', 'UTC')
        ),
        -- Get affected wallet/condition/outcome combos
        affected_positions AS (
          SELECT DISTINCT wallet, condition_id, outcome_index
          FROM trades_in_slice
        ),
        -- Now aggregate ALL trades for affected positions (full position state)
        all_trades_for_affected AS (
          SELECT
            t.trader_wallet AS wallet,
            m.condition_id,
            m.outcome_index,
            CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END / 1000000.0 AS usdc_delta,
            CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END / 1000000.0 AS token_delta,
            t.trade_time
          FROM pm_trader_events_dedup_v2_tbl t
          INNER JOIN pm_token_to_condition_map_v4 m
            ON toString(t.token_id) = toString(m.token_id_dec)
          WHERE (t.trader_wallet, m.condition_id, m.outcome_index) IN (
            SELECT wallet, condition_id, outcome_index FROM affected_positions
          )
        ),
        positions AS (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow_usd,
            sum(token_delta) AS final_shares,
            count() AS trade_count,
            min(trade_time) AS first_trade_at,
            max(trade_time) AS last_trade_at
          FROM all_trades_for_affected
          GROUP BY wallet, condition_id, outcome_index
        )
      SELECT
        p.wallet,
        p.condition_id,
        p.outcome_index,
        p.cash_flow_usd,
        p.final_shares,
        p.trade_count,
        p.first_trade_at,
        p.last_trade_at,
        CASE
          WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 0 THEN 0.0
          WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 1 THEN 1.0
          WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 0 THEN 1.0
          WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 1 THEN 0.0
          ELSE NULL
        END AS payout_norm,
        CASE WHEN r.payout_numerators IS NOT NULL THEN 1 ELSE 0 END AS is_resolved
      FROM positions p
      LEFT JOIN pm_condition_resolutions r
        ON lower(p.condition_id) = lower(r.condition_id)
        AND r.is_deleted = 0
    `;

    await clickhouse.command({ query: insertQuery });

    // Step 6: Count affected positions and wallets
    const countResult = await clickhouse.query({
      query: `
        SELECT
          count() as positions,
          uniqExact(wallet) as wallets
        FROM pm_trader_events_dedup_v2_tbl t
        INNER JOIN pm_token_to_condition_map_v4 m
          ON toString(t.token_id) = toString(m.token_id_dec)
        WHERE t.trade_time > toDateTime('${watermarkBefore}', 'UTC')
          AND t.trade_time <= toDateTime('${sliceEnd}', 'UTC')
      `,
      format: 'JSONEachRow',
    });
    const counts = ((await countResult.json()) as any[])[0];
    const positionsUpserted = Number(counts?.positions || 0);
    const walletsAffected = Number(counts?.wallets || 0);

    // Step 7: Advance watermark
    await clickhouse.command({
      query: `
        INSERT INTO pm_sync_state_v1 (table_name, watermark_time, rows_processed, notes)
        VALUES ('pm_wallet_position_fact_v1', '${sliceEnd}', ${positionsUpserted}, 'Incremental sync')
      `,
    });

    const durationMs = Date.now() - startTime;

    const result: SyncResult = {
      success: true,
      skipped: false,
      watermarkBefore,
      watermarkAfter: sliceEnd,
      sourceLatest,
      positionsUpserted,
      walletsAffected,
      durationMs,
    };

    console.log(`[sync-position-fact] Complete:`, result);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[sync-position-fact] Error:', error);

    const result: SyncResult = {
      success: false,
      skipped: false,
      watermarkBefore: '',
      watermarkAfter: '',
      sourceLatest: '',
      positionsUpserted: 0,
      walletsAffected: 0,
      durationMs: Date.now() - startTime,
      error: error.message,
    };

    return NextResponse.json(result, { status: 500 });
  }
}
