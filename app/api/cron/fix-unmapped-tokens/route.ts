/**
 * Fix Unmapped Tokens Cron Job
 *
 * Runs after rebuild-token-map to fix remaining unmapped tokens via Gamma API.
 * Targets tokens from last 14 days of trades that don't have mappings.
 *
 * Schedule: 0 7 * * * (daily at 7am UTC, 1 hour after rebuild-token-map at 6am)
 *
 * Timeout: ~55 seconds per batch of 500 tokens
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const BATCH_SIZE = 500; // Process 500 tokens per cron run
const DELAY_MS = 50; // Rate limit: 20 requests/second

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  category?: string;
  clobTokenIds?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTokenInfo(tokenIdDec: string): Promise<GammaMarket | null> {
  try {
    const url = `${GAMMA_API_BASE}/markets?clob_token_ids=${tokenIdDec}`;
    const res = await fetch(url);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as GammaMarket[];
    if (data && data.length > 0) {
      return data[0];
    }
    return null;
  } catch {
    return null;
  }
}

async function fixUnmappedTokens(): Promise<{
  unmappedBefore: number;
  processed: number;
  found: number;
  notFound: number;
  inserted: number;
  coveragePct: number;
  duration: number;
}> {
  const startTime = Date.now();
  console.log('\n🔧 FIX UNMAPPED TOKENS (CRON)');
  console.log('='.repeat(60));

  // Step 1: Find unmapped tokens from recent trades
  const q1 = `
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 14 DAY
    )
    SELECT r.token_id
    FROM recent_tokens r
    LEFT JOIN pm_token_to_condition_map_v5 v5 ON r.token_id = v5.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON r.token_id = p.token_id_dec
    WHERE (v5.condition_id IS NULL OR v5.condition_id = '')
      AND (p.condition_id IS NULL OR p.condition_id = '')
    LIMIT ${BATCH_SIZE}
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const unmappedTokens = (await r1.json()) as { token_id: string }[];
  const unmappedBefore = unmappedTokens.length;
  console.log(`Found ${unmappedBefore} unmapped tokens to process`);

  if (unmappedBefore === 0) {
    console.log('All recent tokens are mapped!');
    return {
      unmappedBefore: 0,
      processed: 0,
      found: 0,
      notFound: 0,
      inserted: 0,
      coveragePct: 100,
      duration: Date.now() - startTime,
    };
  }

  // Step 2: Fetch from Gamma API
  const results: {
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
    question: string;
    category: string;
  }[] = [];

  let found = 0;
  let notFound = 0;

  for (let i = 0; i < unmappedTokens.length; i++) {
    const tokenId = unmappedTokens[i].token_id;
    const market = await fetchTokenInfo(tokenId);

    if (market && market.conditionId) {
      // Determine outcome_index from clobTokenIds array position
      let outcomeIndex = 0;
      if (market.clobTokenIds) {
        try {
          const tokenIds = JSON.parse(market.clobTokenIds);
          if (Array.isArray(tokenIds)) {
            const idx = tokenIds.indexOf(tokenId);
            if (idx >= 0) outcomeIndex = idx;
          }
        } catch {
          // Keep default
        }
      }

      results.push({
        token_id_dec: tokenId,
        condition_id: market.conditionId.replace(/^0x/, '').toLowerCase(),
        outcome_index: outcomeIndex,
        question: market.question || 'Unknown',
        category: market.category || 'Other',
      });
      found++;
    } else {
      notFound++;
    }

    // Progress update every 100 tokens
    if ((i + 1) % 100 === 0) {
      console.log(`  Progress: ${i + 1}/${unmappedTokens.length} (found: ${found}, not found: ${notFound})`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`API results: ${found} found, ${notFound} not found`);

  // Step 3: Insert into patch table
  let inserted = 0;
  if (results.length > 0) {
    const insertBatchSize = 100;
    for (let i = 0; i < results.length; i += insertBatchSize) {
      const batch = results.slice(i, i + insertBatchSize);

      const values = batch
        .map(
          (m) =>
            `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, '${m.question.replace(/'/g, "''")}', '${m.category.replace(/'/g, "''")}', 'cron_gamma_api', now())`
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
    console.log(`Inserted ${inserted} new mappings into patch table`);
  }

  // Step 4: Check updated coverage
  const coverageQ = `
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
    )
    SELECT
      count() as total_recent,
      countIf(v5.token_id_dec IS NOT NULL OR p.token_id_dec IS NOT NULL) as mapped,
      countIf(v5.token_id_dec IS NULL AND p.token_id_dec IS NULL) as unmapped
    FROM recent_tokens t
    LEFT JOIN pm_token_to_condition_map_v5 v5 ON t.token_id = v5.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON t.token_id = p.token_id_dec
  `;

  const coverageR = await clickhouse.query({ query: coverageQ, format: 'JSONEachRow' });
  const coverage = (await coverageR.json()) as { total_recent: number; mapped: number; unmapped: number }[];
  const cov = coverage[0];
  const coveragePct = cov.total_recent > 0 ? Math.round((cov.mapped / cov.total_recent) * 1000) / 10 : 100;

  const duration = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('FIX UNMAPPED COMPLETE');
  console.log(`   Processed: ${unmappedBefore} tokens`);
  console.log(`   Found: ${found}, Not Found: ${notFound}`);
  console.log(`   Inserted: ${inserted} new mappings`);
  console.log(`   Coverage (14d): ${cov.mapped}/${cov.total_recent} (${coveragePct}%)`);
  console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  return {
    unmappedBefore,
    processed: unmappedTokens.length,
    found,
    notFound,
    inserted,
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
  const authResult = verifyCronRequest(request, 'fix-unmapped-tokens');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  try {
    const stats = await fixUnmappedTokens();

    return NextResponse.json({
      success: true,
      message: 'Unmapped tokens fixed successfully',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('[Cron] Fix unmapped tokens failed:', error);
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
