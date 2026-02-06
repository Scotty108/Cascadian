/**
 * V5 Token Map Rebuild Cron Job (ADDITIVE MODE)
 *
 * Runs every 6 hours to ADD new tokens to pm_token_to_condition_map_v5 from pm_market_metadata.
 * Uses ADDITIVE pattern (INSERT only new tokens) to prevent data loss.
 *
 * Also merges tokens from pm_token_to_condition_patch into the main map.
 *
 * This ensures that new tokens from metadata sync get added to the token map,
 * enabling PnL calculations for recent trades.
 *
 * Timeout: ~20-30 seconds (safe for Vercel Pro 60s limit)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes max

interface RebuildStats {
  beforeCount: number;
  afterCount: number;
  newFromMetadata: number;
  newFromPatch: number;
  coveragePct: number;
  duration: number;
}

// ============================================================================
// Main Rebuild Logic (ADDITIVE MODE)
// ============================================================================

async function rebuildTokenMap(): Promise<RebuildStats> {
  const startTime = Date.now();
  console.log('\n🔄 V5 TOKEN MAP REBUILD (ADDITIVE MODE)');
  console.log('='.repeat(60));

  // Step 1: Get current V5 count
  let beforeCount = 0;
  try {
    const beforeQ = await clickhouse.query({
      query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
      format: 'JSONEachRow',
    });
    const beforeRows = (await beforeQ.json()) as any[];
    beforeCount = parseInt(beforeRows[0]?.cnt || '0');
    console.log(`Current V5: ${beforeCount.toLocaleString()} tokens`);
  } catch (e: any) {
    console.log(`Current V5 table missing: ${e.message}`);
    // If table doesn't exist, create it
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS pm_token_to_condition_map_v5 (
          token_id_dec String,
          condition_id String,
          outcome_index Int64,
          question String,
          category String
        ) ENGINE = SharedReplacingMergeTree
        ORDER BY (token_id_dec)
        SETTINGS index_granularity = 8192
      `,
    });
  }

  // Step 2: Insert NEW tokens from metadata (that don't already exist)
  // OPTIMIZED: Use LEFT JOIN anti-pattern instead of NOT EXISTS (much faster)
  console.log('Inserting new tokens from metadata...');
  const metadataInsertResult = await clickhouse.command({
    query: `
      INSERT INTO pm_token_to_condition_map_v5
      SELECT
        new_tokens.token_id_dec,
        new_tokens.condition_id,
        new_tokens.outcome_index,
        new_tokens.question,
        new_tokens.category
      FROM (
        SELECT
          arrayJoin(arrayEnumerate(token_ids)) AS idx,
          token_ids[idx] AS token_id_dec,
          condition_id,
          toInt64(idx - 1) AS outcome_index,
          question,
          category
        FROM pm_market_metadata FINAL
        WHERE length(token_ids) > 0
      ) new_tokens
      LEFT JOIN pm_token_to_condition_map_v5 existing
        ON new_tokens.token_id_dec = existing.token_id_dec
      WHERE existing.token_id_dec IS NULL
    `,
    clickhouse_settings: { join_use_nulls: 1 },
  });

  // Count how many were added from metadata
  const metaCountQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const metaCountRows = (await metaCountQ.json()) as any[];
  const afterMetadata = parseInt(metaCountRows[0]?.cnt || '0');
  const newFromMetadata = afterMetadata - beforeCount;
  console.log(`  Added ${newFromMetadata.toLocaleString()} tokens from metadata`);

  // Step 3: Merge tokens from patch table (that don't already exist)
  // OPTIMIZED: Use LEFT JOIN anti-pattern instead of NOT EXISTS (much faster)
  console.log('Merging tokens from patch table...');
  await clickhouse.command({
    query: `
      INSERT INTO pm_token_to_condition_map_v5
      SELECT
        patch.token_id_dec,
        patch.condition_id,
        patch.outcome_index,
        patch.question,
        patch.category
      FROM pm_token_to_condition_patch patch
      LEFT JOIN pm_token_to_condition_map_v5 existing
        ON patch.token_id_dec = existing.token_id_dec
      WHERE existing.token_id_dec IS NULL
    `,
    clickhouse_settings: { join_use_nulls: 1 },
  });

  // Step 4: Get final count
  const afterQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const afterRows = (await afterQ.json()) as any[];
  const afterCount = parseInt(afterRows[0]?.cnt || '0');
  const newFromPatch = afterCount - afterMetadata;
  console.log(`  Added ${newFromPatch.toLocaleString()} tokens from patch table`);
  console.log(`Final V5: ${afterCount.toLocaleString()} tokens`);

  // Step 5: Check coverage for recent trades
  const coverageQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(m.token_id_dec IS NOT NULL) as mapped
      FROM (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
      ) r
      LEFT JOIN pm_token_to_condition_map_v5 m ON r.token_id = m.token_id_dec
    `,
    format: 'JSONEachRow',
  });
  const coverageRows = (await coverageQ.json()) as any[];
  const total = parseInt(coverageRows[0]?.total || '0');
  const mapped = parseInt(coverageRows[0]?.mapped || '0');
  const coveragePct = total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0;
  console.log(`Coverage (14d): ${mapped}/${total} tokens (${coveragePct}%)`);

  const duration = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('✅ ADDITIVE REBUILD COMPLETE');
  console.log(`   Before: ${beforeCount.toLocaleString()} tokens`);
  console.log(`   After:  ${afterCount.toLocaleString()} tokens`);
  console.log(`   New from metadata: +${newFromMetadata.toLocaleString()}`);
  console.log(`   New from patch: +${newFromPatch.toLocaleString()}`);
  console.log(`   Coverage: ${coveragePct}%`);
  console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  // Log sync status for freshness tracking
  try {
    await clickhouse.command({
      query: `
        INSERT INTO pm_sync_status (sync_type, last_success_at, records_synced, coverage_pct, duration_ms)
        VALUES ('token_map_rebuild', now(), ${afterCount}, ${coveragePct}, ${duration})
      `,
    });
    console.log('✅ Logged sync status to pm_sync_status');
  } catch (err) {
    console.warn('⚠️  Failed to log sync status:', err);
  }

  return {
    beforeCount,
    afterCount,
    newFromMetadata,
    newFromPatch,
    coveragePct,
    duration,
  };
}

// ============================================================================
// Auth & Route Handlers
// ============================================================================

import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'rebuild-token-map');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const stats = await rebuildTokenMap();
    const durationMs = Date.now() - startTime;

    await logCronExecution({
      cron_name: 'rebuild-token-map',
      status: 'success',
      duration_ms: durationMs,
      details: {
        beforeCount: stats.beforeCount,
        afterCount: stats.afterCount,
        newFromMetadata: stats.newFromMetadata,
        newFromPatch: stats.newFromPatch,
        coveragePct: stats.coveragePct
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Token map V5 updated (additive mode)',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[Cron] Rebuild failed:', error);

    await logCronExecution({
      cron_name: 'rebuild-token-map',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
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
