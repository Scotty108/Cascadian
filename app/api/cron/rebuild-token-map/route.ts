/**
 * V5 Token Map Rebuild Cron Job
 *
 * Runs every 6 hours to rebuild pm_token_to_condition_map_v5 from pm_market_metadata.
 * Uses atomic rebuild pattern (CREATE NEW → RENAME) to avoid data loss.
 *
 * This ensures that new tokens from metadata sync get added to the token map,
 * enabling PnL calculations for recent trades.
 *
 * Timeout: ~20-30 seconds (safe for Vercel Pro 60s limit)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

interface RebuildStats {
  beforeCount: number;
  afterCount: number;
  delta: number;
  coveragePct: number;
  duration: number;
}

// ============================================================================
// Main Rebuild Logic
// ============================================================================

async function rebuildTokenMap(): Promise<RebuildStats> {
  const startTime = Date.now();
  console.log('\n🔄 V5 TOKEN MAP REBUILD');
  console.log('='.repeat(60));

  // Step 1: Get current V5 count
  const beforeQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const beforeRows = (await beforeQ.json()) as any[];
  const beforeCount = parseInt(beforeRows[0]?.cnt || '0');
  console.log(`Current V5: ${beforeCount.toLocaleString()} tokens`);

  // Step 2: Check metadata source has enough data
  const metaQ = await clickhouse.query({
    query: `
      SELECT sum(length(token_ids)) as total_tokens
      FROM pm_market_metadata FINAL
      WHERE length(token_ids) > 0
    `,
    format: 'JSONEachRow',
  });
  const metaRows = (await metaQ.json()) as any[];
  const expectedTokens = parseInt(metaRows[0]?.total_tokens || '0');
  console.log(`Metadata has: ${expectedTokens.toLocaleString()} tokens`);

  // Safety check: don't rebuild if metadata looks empty/broken
  if (expectedTokens < 50000) {
    console.error(`❌ Metadata too small (${expectedTokens}), aborting to prevent data loss`);
    throw new Error(`Metadata only has ${expectedTokens} tokens, expected 50k+`);
  }

  // Step 3: Create new table with fresh data
  console.log('Creating pm_token_to_condition_map_v5_new...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_new' });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_token_to_condition_map_v5_new
      ENGINE = ReplacingMergeTree()
      ORDER BY (token_id_dec)
      SETTINGS index_granularity = 8192
      AS
      SELECT
        token_id_dec,
        condition_id,
        outcome_index,
        question,
        category
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
      )
    `,
  });

  // Step 4: Verify new table
  const afterQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5_new',
    format: 'JSONEachRow',
  });
  const afterRows = (await afterQ.json()) as any[];
  const afterCount = parseInt(afterRows[0]?.cnt || '0');
  console.log(`New V5: ${afterCount.toLocaleString()} tokens`);

  // Safety check: new table shouldn't be much smaller
  if (afterCount < beforeCount * 0.9) {
    console.error(`❌ New table too small (${afterCount} vs ${beforeCount}), aborting swap`);
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_new' });
    throw new Error(`New table has ${afterCount} tokens but old had ${beforeCount}`);
  }

  // Step 5: Atomic swap
  console.log('Performing atomic swap...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5 TO pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5_new TO pm_token_to_condition_map_v5' });
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });
  console.log('Swap complete!');

  // Step 6: Check coverage for recent trades
  const coverageQ = await clickhouse.query({
    query: `
      WITH recent_tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
      )
      SELECT
        count() as total,
        countIf(m.token_id_dec IS NOT NULL) as mapped
      FROM recent_tokens r
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
  console.log('✅ REBUILD COMPLETE');
  console.log(`   Before: ${beforeCount.toLocaleString()} tokens`);
  console.log(`   After:  ${afterCount.toLocaleString()} tokens`);
  console.log(`   Delta:  ${(afterCount - beforeCount).toLocaleString()} tokens`);
  console.log(`   Coverage: ${coveragePct}%`);
  console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  return {
    beforeCount,
    afterCount,
    delta: afterCount - beforeCount,
    coveragePct,
    duration,
  };
}

// ============================================================================
// Auth & Route Handlers
// ============================================================================

function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || process.env.ADMIN_API_KEY;

  if (!cronSecret) {
    console.warn('[Cron] No CRON_SECRET configured, allowing request');
    return true;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await rebuildTokenMap();

    return NextResponse.json({
      success: true,
      message: 'Token map V5 rebuilt successfully',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Cron] Rebuild failed:', error);
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
