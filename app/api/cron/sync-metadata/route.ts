/**
 * Market Metadata Quick Sync Cron Job
 *
 * Runs every 10 minutes to:
 * 1. Fetch the most recent ~1000 markets from Gamma API
 * 2. Update existing records (idempotent via ReplacingMergeTree)
 * 3. Capture new market drops and volume changes
 *
 * This is the "Quick Sync" approach - the full historical backfill
 * is run locally via scripts/ingest-market-metadata.ts
 *
 * Timeout: ~30-45 seconds (safe for Vercel Pro 60s limit)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import type { GammaMarketMetadata } from '@/types/polymarket';
import { enrichMarketTags } from '@/lib/enrich-market-tags';

const API_URL = 'https://gamma-api.polymarket.com/markets';
const QUICK_SYNC_LIMIT = 1000; // Fetch most recent 1000 markets
const BATCH_SIZE = 500; // Insert in batches of 500

interface SyncStats {
  marketsFetched: number;
  marketsUpdated: number;
  errors: number;
  duration: number;
}

// ============================================================================
// Helper Functions (same as ingest script)
// ============================================================================

function normalizeConditionId(conditionId: string | undefined): string {
  if (!conditionId) return '';
  return conditionId.toLowerCase().replace(/^0x/, '');
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function parseTags(tags: any): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map(t => {
      if (typeof t === 'string') return t;
      if (t && typeof t === 'object' && 'label' in t) return t.label;
      return '';
    }).filter(Boolean);
  }
  return [];
}

function transformToMetadata(raw: any): GammaMarketMetadata {
  const isActive = raw.active && !raw.closed;
  const conditionId = raw.conditionId || raw.condition_id || '';
  const volume = parseFloat(raw.volume || raw.volumeNum || '0');

  // Extract tags from category and mailchimpTag (NOT from raw.tags which doesn't exist!)
  const initialTags: string[] = [];
  if (raw.category) {
    initialTags.push(raw.category);
  }
  if (raw.mailchimpTag) {
    initialTags.push(`mailchimp:${raw.mailchimpTag}`);
  }
  // HIDDEN TAG DISCOVERY: Extract series title (NBA, UFC, etc.) - boosts coverage from 2% to 50%+
  if (raw.events?.[0]?.series?.[0]?.title) {
    initialTags.push(raw.events[0].series[0].title);
  }

  // ENRICHMENT V3: Use API category as primary source
  // Priority: raw.category > raw.events[0].category > fallback to 'Other'
  const apiCategory = raw.category || raw.events?.[0]?.category || '';
  const enrichmentResult = enrichMarketTags(raw.question || '', initialTags, apiCategory);
  const tags = enrichmentResult.enrichedTags;
  const category = enrichmentResult.category;

  // Parse outcomes array (API returns JSON string like "[\"Yes\", \"No\"]", not array!)
  let outcomes: string[] = [];
  if (Array.isArray(raw.outcomes)) {
    outcomes = raw.outcomes;
  } else if (typeof raw.outcomes === 'string' && raw.outcomes) {
    try {
      const parsed = JSON.parse(raw.outcomes);
      outcomes = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn(`⚠️  Failed to parse outcomes for market ${raw.id}:`, e);
      outcomes = [];
    }
  }

  // Parse outcome prices (store as JSON string)
  const outcomePrices = raw.outcomePrices
    ? JSON.stringify(raw.outcomePrices)
    : '';

  // Parse token IDs (CRITICAL - enables position-to-market join)
  // Extract tokenId values from clobTokenIds (API returns JSON string, not array!)
  let tokenIds: string[] = [];

  if (Array.isArray(raw.tokens)) {
    tokenIds = raw.tokens.map((token: any) => token.tokenId || '').filter(Boolean);
  } else if (raw.clobTokenIds) {
    // clobTokenIds is a JSON STRING, not an array! Need to parse it.
    try {
      const parsed = JSON.parse(raw.clobTokenIds);
      tokenIds = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn(`⚠️  Failed to parse clobTokenIds for market ${raw.id}:`, e);
      tokenIds = [];
    }
  }

  // Parse liquidity (NEW - market depth)
  const liquidity = parseFloat(raw.liquidity || '0');

  // Parse spread, bid, ask (NEW - market depth)
  const spread = parseFloat(raw.spread || '0');
  const bestBid = parseFloat(raw.bestBid || raw.best_bid || '0');
  const bestAsk = parseFloat(raw.bestAsk || raw.best_ask || '0');

  // Parse rewards data (NEW - market maker incentives)
  const rewardsMinSize = parseFloat(raw.rewardsMinSize || raw.rewards?.minSize || '0');
  const rewardsMaxSpread = parseFloat(raw.rewardsMaxSpread || raw.rewards?.maxSpread || '0');

  // ========== HIGH PRIORITY FIELD EXTRACTION ==========

  // Market type & bounds (distinguishes binary vs scalar markets)
  const marketType = raw.marketType || 'normal';
  const formatType = raw.formatType || '';
  const lowerBound = raw.lowerBound || '';
  const upperBound = raw.upperBound || '';

  // Time-based volumes (trending indicators)
  const volume24hr = parseFloat(raw.volume24hr || '0');
  const volume1wk = parseFloat(raw.volume1wk || '0');
  const volume1mo = parseFloat(raw.volume1mo || '0');

  // Price changes (momentum indicators)
  const priceChange1d = parseFloat(raw.oneDayPriceChange || '0');
  const priceChange1w = parseFloat(raw.oneWeekPriceChange || '0');

  // Series grouping (powerful recurring market grouping!)
  const seriesSlug = raw.events?.[0]?.seriesSlug || '';
  const seriesData = raw.events?.[0]?.series?.[0]
    ? JSON.stringify(raw.events[0].series[0])
    : '';

  // Community engagement
  const commentCount = parseInt(raw.events?.[0]?.commentCount || '0');

  // State flags
  const isRestricted = raw.restricted ? 1 : 0;
  const isArchived = raw.archived ? 1 : 0;
  const wideFormat = raw.wideFormat ? 1 : 0;

  return {
    // Core identifiers
    condition_id: normalizeConditionId(conditionId),
    market_id: raw.id || '',
    slug: raw.slug || '',

    // Market content
    question: raw.question || '',
    outcome_label: raw.groupItemTitle || raw.title || '',
    description: raw.description || '',
    image_url: raw.image || raw.icon || '',
    tags,
    category,

    // Market state
    is_active: isActive ? 1 : 0,
    is_closed: raw.closed ? 1 : 0,

    // Resolution data (NEW)
    winning_outcome: raw.winningOutcome || raw.winning_outcome || '',
    resolution_source: raw.resolutionSource || raw.resolution_source || '',

    // Market depth (NEW)
    liquidity_usdc: liquidity,
    spread,
    best_bid: bestBid,
    best_ask: bestAsk,

    // Volume
    volume_usdc: volume,

    // Outcomes array (NEW)
    outcomes,
    outcome_prices: outcomePrices,

    // Token IDs (CRITICAL - enables position-to-market join)
    token_ids: tokenIds,

    // Event grouping (NEW - extract from events array, not flat structure)
    event_id: raw.events?.[0]?.id || '',
    group_slug: raw.events?.[0]?.slug || raw.slug || '',

    // Market configuration (NEW)
    enable_order_book: raw.enableOrderBook ? 1 : 0,
    order_price_min_tick_size: parseFloat(raw.orderPriceMinTickSize || raw.order_price_min_tick_size || '0'),
    notifications_enabled: raw.notificationsEnabled ? 1 : 0,

    // Rewards/incentives (NEW)
    rewards_min_size: rewardsMinSize,
    rewards_max_spread: rewardsMaxSpread,

    // Market type & bounds (HIGH PRIORITY)
    market_type: marketType,
    format_type: formatType,
    lower_bound: lowerBound,
    upper_bound: upperBound,

    // Time-based volumes (HIGH PRIORITY)
    volume_24hr: volume24hr,
    volume_1wk: volume1wk,
    volume_1mo: volume1mo,

    // Price changes (HIGH PRIORITY)
    price_change_1d: priceChange1d,
    price_change_1w: priceChange1w,

    // Series grouping (HIGH PRIORITY)
    series_slug: seriesSlug,
    series_data: seriesData,

    // Engagement metrics (HIGH PRIORITY)
    comment_count: commentCount,

    // State flags (HIGH PRIORITY)
    is_restricted: isRestricted,
    is_archived: isArchived,
    wide_format: wideFormat,

    // Timestamps
    start_date: parseDate(raw.startDate || raw.start_date_iso),
    end_date: parseDate(raw.endDate || raw.end_date_iso),
    created_at: parseDate(raw.createdAt || raw.created_at),
    updated_at: parseDate(raw.updatedAt || raw.updated_at),
    ingested_at: Date.now(),
  };
}

function formatForInsert(metadata: GammaMarketMetadata): string {
  const escape = (str: string) => str.replace(/'/g, "\\'").replace(/\n/g, ' ');

  // Format arrays
  const tags = `[${metadata.tags.map(t => `'${escape(t)}'`).join(', ')}]`;
  const outcomes = `[${metadata.outcomes.map(o => `'${escape(o)}'`).join(', ')}]`;
  const tokenIds = `[${metadata.token_ids.map(id => `'${escape(id)}'`).join(', ')}]`;

  // Format nullable DateTime fields
  const startDate = metadata.start_date
    ? `'${metadata.start_date.toISOString()}'`
    : 'NULL';
  const endDate = metadata.end_date
    ? `'${metadata.end_date.toISOString()}'`
    : 'NULL';
  const createdAt = metadata.created_at
    ? `'${metadata.created_at.toISOString()}'`
    : 'NULL';
  const updatedAt = metadata.updated_at
    ? `'${metadata.updated_at.toISOString()}'`
    : 'NULL';

  return `(
    '${escape(metadata.condition_id)}',
    '${escape(metadata.market_id)}',
    '${escape(metadata.slug)}',
    '${escape(metadata.question)}',
    '${escape(metadata.outcome_label)}',
    '${escape(metadata.description)}',
    '${escape(metadata.image_url)}',
    ${tags},
    '${escape(metadata.category)}',
    ${metadata.volume_usdc},
    ${metadata.is_active},
    ${metadata.is_closed},
    ${endDate},
    ${metadata.ingested_at},
    ${metadata.liquidity_usdc},
    ${outcomes},
    '${escape(metadata.outcome_prices)}',
    ${tokenIds},
    '${escape(metadata.winning_outcome)}',
    '${escape(metadata.resolution_source)}',
    ${metadata.enable_order_book},
    ${metadata.order_price_min_tick_size},
    ${metadata.notifications_enabled},
    '${escape(metadata.event_id)}',
    '${escape(metadata.group_slug)}',
    ${metadata.rewards_min_size},
    ${metadata.rewards_max_spread},
    ${metadata.spread},
    ${metadata.best_bid},
    ${metadata.best_ask},
    '${escape(metadata.market_type)}',
    '${escape(metadata.format_type)}',
    '${escape(metadata.lower_bound)}',
    '${escape(metadata.upper_bound)}',
    ${metadata.volume_24hr},
    ${metadata.volume_1wk},
    ${metadata.volume_1mo},
    ${metadata.price_change_1d},
    ${metadata.price_change_1w},
    '${escape(metadata.series_slug)}',
    '${escape(metadata.series_data)}',
    ${metadata.comment_count},
    ${metadata.is_restricted},
    ${metadata.is_archived},
    ${metadata.wide_format},
    ${startDate},
    ${createdAt},
    ${updatedAt}
  )`;
}

// ============================================================================
// API Fetching
// ============================================================================

async function fetchRecentMarkets(): Promise<any[]> {
  try {
    // Fetch most recent markets (sorted by creation date descending by default)
    const url = `${API_URL}?limit=${QUICK_SYNC_LIMIT}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[Cron] Failed to fetch markets:', error);
    throw error;
  }
}

// ============================================================================
// Database Operations
// ============================================================================

async function insertBatch(batch: GammaMarketMetadata[]): Promise<void> {
  if (batch.length === 0) return;

  const values = batch.map(formatForInsert).join(',\n');

  const query = `
    INSERT INTO pm_market_metadata (
      condition_id,
      market_id,
      slug,
      question,
      outcome_label,
      description,
      image_url,
      tags,
      category,
      volume_usdc,
      is_active,
      is_closed,
      end_date,
      ingested_at,
      liquidity_usdc,
      outcomes,
      outcome_prices,
      token_ids,
      winning_outcome,
      resolution_source,
      enable_order_book,
      order_price_min_tick_size,
      notifications_enabled,
      event_id,
      group_slug,
      rewards_min_size,
      rewards_max_spread,
      spread,
      best_bid,
      best_ask,
      market_type,
      format_type,
      lower_bound,
      upper_bound,
      volume_24hr,
      volume_1wk,
      volume_1mo,
      price_change_1d,
      price_change_1w,
      series_slug,
      series_data,
      comment_count,
      is_restricted,
      is_archived,
      wide_format,
      start_date,
      created_at,
      updated_at
    ) VALUES
    ${values}
  `;

  await clickhouse.command({ query });
}

// ============================================================================
// Main Sync Logic
// ============================================================================

async function quickSync(): Promise<SyncStats> {
  const startTime = Date.now();
  const stats: SyncStats = {
    marketsFetched: 0,
    marketsUpdated: 0,
    errors: 0,
    duration: 0,
  };

  console.log('\n🔄 QUICK METADATA SYNC');
  console.log('='.repeat(60));

  try {
    // Fetch recent markets
    console.log(`📡 Fetching ${QUICK_SYNC_LIMIT} most recent markets...`);
    const rawMarkets = await fetchRecentMarkets();
    stats.marketsFetched = rawMarkets.length;
    console.log(`  Fetched ${rawMarkets.length} markets`);

    // Transform and filter
    const markets = rawMarkets
      .map(transformToMetadata)
      .filter(m => m.condition_id && m.condition_id.length > 0);

    console.log(`  Transformed ${markets.length} valid records`);

    // Insert in batches
    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      await insertBatch(batch);
      stats.marketsUpdated += batch.length;
      console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} markets`);
    }

  } catch (error: any) {
    console.error('[Cron] Sync error:', error);
    stats.errors++;
    throw error;
  }

  stats.duration = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('📊 SYNC SUMMARY');
  console.log('='.repeat(60));
  console.log(`Markets Fetched:    ${stats.marketsFetched}`);
  console.log(`Markets Updated:    ${stats.marketsUpdated}`);
  console.log(`Errors:             ${stats.errors}`);
  console.log(`Duration:           ${(stats.duration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  return stats;
}

// ============================================================================
// Auth & Route Handlers
// ============================================================================

function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || process.env.ADMIN_API_KEY;

  if (!cronSecret) {
    console.warn('[Cron] No CRON_SECRET configured, allowing request');
    return true; // Allow if not configured (dev mode)
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  // Verify authorization
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await quickSync();

    return NextResponse.json({
      success: true,
      message: 'Metadata quick sync completed',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Cron] Sync failed:', error);
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
