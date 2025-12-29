/**
 * Sync Token Mapping from CTF Events Cron Job
 *
 * Derives token_id from condition_id using keccak256 hash.
 * This catches 15-minute crypto markets that Gamma API misses.
 *
 * CTF events contain condition_id for PayoutRedemption/PositionSplit events.
 * We can derive token_id = keccak256(conditionId || outcomeIndex).
 *
 * Schedule: every 15 minutes (for 15-min market coverage)
 *
 * Timeout: ~20-30 seconds (safe for Vercel Pro 60s limit)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

// Compute token_id from condition_id and outcome_index
// Polymarket uses: keccak256(abi.encodePacked(conditionId, outcomeSlotIndex))
function computeTokenId(conditionId: string, outcomeIndex: number): string {
  // Ensure condition_id has 0x prefix
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;

  // Pack conditionId (bytes32) + outcomeIndex (uint256)
  const packed = encodePacked(
    ['bytes32', 'uint256'],
    [condId as `0x${string}`, BigInt(outcomeIndex)]
  );
  const hash = keccak256(packed);

  // Convert to decimal string (Polymarket uses decimal token IDs)
  return BigInt(hash).toString();
}

interface SyncStats {
  unmappedConditionsFound: number;
  newMappingsComputed: number;
  inserted: number;
  duration: number;
}

async function syncCTFTokenMap(): Promise<SyncStats> {
  const startTime = Date.now();
  console.log('\n🔗 SYNC TOKEN MAP FROM CTF EVENTS');
  console.log('='.repeat(60));

  // Step 1: Find condition_ids from recent CTF events that aren't in mapping
  // Focus on last 24 hours for efficiency
  console.log('Step 1: Finding unmapped condition_ids from recent CTF events...');

  const q1 = `
    WITH recent_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND condition_id != ''
        AND event_timestamp >= now() - INTERVAL 1 DAY
    ),
    mapped_conditions AS (
      SELECT DISTINCT condition_id FROM pm_token_to_condition_map_v5
      UNION DISTINCT
      SELECT DISTINCT condition_id FROM pm_token_to_condition_patch
    )
    SELECT c.condition_id
    FROM recent_conditions c
    LEFT JOIN mapped_conditions m ON c.condition_id = m.condition_id
    WHERE m.condition_id IS NULL OR m.condition_id = ''
    LIMIT 5000
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const unmappedConditions = (await r1.json()) as { condition_id: string }[];
  console.log(`Found ${unmappedConditions.length} unmapped condition_ids`);

  if (unmappedConditions.length === 0) {
    console.log('All recent CTF conditions are mapped!');
    return {
      unmappedConditionsFound: 0,
      newMappingsComputed: 0,
      inserted: 0,
      duration: Date.now() - startTime,
    };
  }

  // Step 2: Compute token_ids for each condition (2 outcomes for binary markets)
  console.log('Step 2: Computing token_ids...');

  const newMappings: {
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }[] = [];

  for (const row of unmappedConditions) {
    const conditionId = row.condition_id;

    // Compute token_id for outcome 0 and 1 (binary markets)
    for (let outcomeIdx = 0; outcomeIdx < 2; outcomeIdx++) {
      try {
        const tokenIdDec = computeTokenId(conditionId, outcomeIdx);
        newMappings.push({
          token_id_dec: tokenIdDec,
          condition_id: conditionId,
          outcome_index: outcomeIdx,
        });
      } catch (e) {
        console.warn(`Failed to compute token_id for ${conditionId}:${outcomeIdx}:`, e);
      }
    }
  }

  console.log(`Computed ${newMappings.length} new token mappings`);

  // Step 3: Insert into patch table
  console.log('Step 3: Inserting into pm_token_to_condition_patch...');

  let inserted = 0;
  const batchSize = 500;

  for (let i = 0; i < newMappings.length; i += batchSize) {
    const batch = newMappings.slice(i, i + batchSize);

    const values = batch
      .map(
        (m) =>
          `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'CTF-derived market', 'Crypto', 'cron_ctf_sync', now())`
      )
      .join(',');

    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_patch
        (token_id_dec, condition_id, outcome_index, question, category, source, created_at)
        VALUES ${values}
      `,
    });

    inserted += batch.length;
  }

  console.log(`Inserted ${inserted} new mappings`);

  const duration = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('✅ CTF TOKEN MAP SYNC COMPLETE');
  console.log(`   Unmapped conditions: ${unmappedConditions.length}`);
  console.log(`   New mappings: ${newMappings.length}`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  return {
    unmappedConditionsFound: unmappedConditions.length,
    newMappingsComputed: newMappings.length,
    inserted,
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
    const stats = await syncCTFTokenMap();

    return NextResponse.json({
      success: true,
      message: 'CTF token map synced successfully',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('[Cron] CTF token map sync failed:', error);
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
