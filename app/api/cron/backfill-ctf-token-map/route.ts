/**
 * Token Mapping Coverage Monitor Cron Job
 *
 * IMPORTANT: As of 2025-12-22, we discovered that keccak256 derivation does NOT work.
 * The token_ids in CLOB come from Gamma API's clobTokenIds field, NOT from
 * cryptographic derivation of condition_ids.
 *
 * This cron NOW just monitors coverage (no inserts):
 * 1. Reports on global token mapping coverage
 * 2. Reports on unmapped CTF conditions
 * 3. Alerts if coverage drops below threshold
 *
 * For 15-minute markets, there is NO KNOWN WAY to map tokens without:
 * 1. Finding an alternative API that indexes these markets
 * 2. Capturing token→market mapping at trade ingestion time
 *
 * Schedule: 0 *​/6 * * * (every 6 hours)
 * Timeout: ~10 seconds
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkGlobalMappingCoverage } from '@/lib/pnl/checkMappingCoverage';
import { clickhouse } from '@/lib/clickhouse/client';

const COVERAGE_ALERT_THRESHOLD = 50; // Alert if coverage drops below 50%

interface MonitoringStats {
  globalCoverage: {
    totalTokens: number;
    mappedV5: number;
    mappedPatch: number;
    mappedCombined: number;
    unmapped: number;
    coveragePct: number;
  };
  unmappedCtfConditions: number;
  alertTriggered: boolean;
  duration: number;
}

async function monitorTokenCoverage(): Promise<MonitoringStats> {
  const startTime = Date.now();
  console.log('\n📊 TOKEN MAPPING COVERAGE MONITOR');
  console.log('='.repeat(60));

  // Check global coverage
  const globalCoverage = await checkGlobalMappingCoverage(14);
  console.log(`Global coverage (14d): ${globalCoverage.coveragePct}%`);
  console.log(`  Mapped (V5): ${globalCoverage.mappedV5.toLocaleString()}`);
  console.log(`  Mapped (Patch): ${globalCoverage.mappedPatch.toLocaleString()}`);
  console.log(`  Unmapped: ${globalCoverage.unmapped.toLocaleString()}`);

  // Count unmapped CTF conditions
  const ctfQ = `
    WITH ctf_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND condition_id != ''
        AND event_timestamp >= now() - INTERVAL 30 DAY
    ),
    v5_conditions AS (
      SELECT DISTINCT condition_id FROM pm_token_to_condition_map_v5
    ),
    patch_conditions AS (
      SELECT DISTINCT condition_id FROM pm_token_to_condition_patch
    )
    SELECT count() as cnt
    FROM ctf_conditions c
    LEFT JOIN v5_conditions v5 ON c.condition_id = v5.condition_id
    LEFT JOIN patch_conditions p ON c.condition_id = p.condition_id
    WHERE (v5.condition_id IS NULL OR v5.condition_id = '')
      AND (p.condition_id IS NULL OR p.condition_id = '')
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfRows = (await ctfR.json()) as { cnt: number }[];
  const unmappedCtfConditions = Number(ctfRows[0]?.cnt || 0);
  console.log(`\nUnmapped CTF conditions (30d): ${unmappedCtfConditions.toLocaleString()}`);

  // Check if alert should be triggered
  const alertTriggered = globalCoverage.coveragePct < COVERAGE_ALERT_THRESHOLD;
  if (alertTriggered) {
    console.log(`\n⚠️ ALERT: Coverage ${globalCoverage.coveragePct}% below threshold ${COVERAGE_ALERT_THRESHOLD}%`);
  }

  const duration = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('MONITORING COMPLETE');
  console.log(`   Coverage: ${globalCoverage.coveragePct}%`);
  console.log(`   Unmapped CTF: ${unmappedCtfConditions}`);
  console.log(`   Alert: ${alertTriggered ? 'YES' : 'NO'}`);
  console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  return {
    globalCoverage,
    unmappedCtfConditions,
    alertTriggered,
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
    const stats = await monitorTokenCoverage();

    return NextResponse.json({
      success: true,
      message: stats.alertTriggered
        ? `Coverage alert: ${stats.globalCoverage.coveragePct}% below ${COVERAGE_ALERT_THRESHOLD}%`
        : 'Token mapping coverage normal',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('[Cron] Token coverage monitoring failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
