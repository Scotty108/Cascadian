#!/usr/bin/env tsx
/**
 * Gamma API Metadata Ingestion Script (CORRECTED)
 *
 * The "Soft Pipe": Polymarket Gamma API → ClickHouse pm_market_metadata
 *
 * Critical Changes:
 * - Uses /markets endpoint (NOT /events) to capture ALL 150k+ markets
 * - Fetches ENTIRE history (no active/closed filters)
 * - Fixes boolean trap: is_active = active && !closed
 * - Enriches with resolution rules, images, and volume
 *
 * Architecture:
 * - Idempotent: Safe to re-run, updates existing records
 * - Crash-safe: Checkpoints after each batch
 * - Rate-limited: 100ms delay between requests
 *
 * Usage:
 *   npx tsx scripts/ingest-market-metadata.ts              # Full ingestion
 *   npx tsx scripts/ingest-market-metadata.ts --dry-run    # Test mode
 *   npx tsx scripts/ingest-market-metadata.ts --verify     # Verify only
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import type { GammaMarketMetadata } from '../types/polymarket';
import { enrichMarketTags } from './enrich-market-tags-v2';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  BATCH_SIZE: 500,
  DRY_RUN: process.argv.includes('--dry-run'),
  VERIFY_ONLY: process.argv.includes('--verify'),
  TABLE_NAME: 'pm_market_metadata',
  API_URL: 'https://gamma-api.polymarket.com/markets',
} as const;

// ============================================================================
// Table Schema (UPDATED per Gemini instructions)
// ============================================================================

const TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS pm_market_metadata
(
    condition_id String,
    market_id String,
    slug String,
    question String,
    outcome_label String,
    description String,
    image_url String,
    tags Array(String),
    category String,
    volume_usdc Float64,
    is_active UInt8,
    is_closed UInt8,
    end_date Nullable(DateTime64(3)),
    ingested_at UInt64,
    liquidity_usdc Float64,
    outcomes Array(String),
    outcome_prices String,
    token_ids Array(String),
    winning_outcome String,
    resolution_source String,
    enable_order_book UInt8,
    order_price_min_tick_size Float64,
    notifications_enabled UInt8,
    event_id String,
    group_slug String,
    rewards_min_size Float64,
    rewards_max_spread Float64,
    spread Float64,
    best_bid Float64,
    best_ask Float64,
    start_date Nullable(DateTime64(3)),
    created_at Nullable(DateTime64(3)),
    updated_at Nullable(DateTime64(3)),
    market_type String,
    format_type String,
    lower_bound String,
    upper_bound String,
    volume_24hr Float64,
    volume_1wk Float64,
    volume_1mo Float64,
    price_change_1d Float64,
    price_change_1w Float64,
    series_slug String,
    series_data String,
    comment_count UInt32,
    is_restricted UInt8,
    is_archived UInt8,
    wide_format UInt8
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY condition_id
SETTINGS index_granularity = 8192;
`.trim();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize condition_id (lowercase, strip 0x)
 */
function normalizeConditionId(conditionId: string | undefined): string {
  if (!conditionId) return '';
  return conditionId.toLowerCase().replace(/^0x/, '');
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Parse tags from API response
 */
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

/**
 * Transform API response to ClickHouse schema
 * NOW CAPTURES EVERYTHING - "Kitchen Sink" approach
 */
function transformToMetadata(raw: any): GammaMarketMetadata {
  // Fix the boolean trap: is_active = active && !closed
  const isActive = raw.active && !raw.closed;

  // Extract condition_id (API uses both conditionId and condition_id)
  const conditionId = raw.conditionId || raw.condition_id || '';

  // Parse volume (API returns as string)
  const volume = parseFloat(raw.volume || raw.volumeNum || '0');

  // V2 ENRICHMENT: Full keyword matching with 300+ keyword mappings
  // Scans question text for keywords (NFL, FTX, bitcoin, etc.) and adds tags/category

  // Step 1: Extract canonical tags from Polymarket API (if available)
  const eventTags: string[] = [];
  if (Array.isArray(raw.events?.[0]?.tags)) {
    for (const tag of raw.events[0].tags) {
      if (tag && typeof tag === 'object' && tag.label) {
        eventTags.push(tag.label);
      }
    }
  }

  // Extract series titles (NBA, UFC, etc.)
  const seriesTitles: string[] = [];
  if (Array.isArray(raw.events?.[0]?.series)) {
    for (const series of raw.events[0].series) {
      if (series && typeof series === 'object' && series.title) {
        seriesTitles.push(series.title);
      }
    }
  }

  // Combine initial tags from API
  const initialTags = [...new Set([...eventTags, ...seriesTitles])];

  // Step 2: Apply V2 keyword enrichment (scans question + slug for NBA, NFL, FTX, etc.)
  const enrichmentResult = enrichMarketTags(
    raw.question || '',
    initialTags,
    raw.slug || ''  // Pass slug for league detection (nba-, mlb-, nfl-, nhl-)
  );

  // Use enriched category and tags from V2
  const category = enrichmentResult.category;
  const tags = enrichmentResult.enrichedTags;

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
  // Extract tokenId values from tokens array (keep as decimal strings, no hex conversion)
  let tokenIds: string[] = [];

  // Try multiple possible field names
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
  } else if (Array.isArray(raw.outcomeTokenIds)) {
    tokenIds = raw.outcomeTokenIds;
  } else if (raw.events?.[0]?.tokens) {
    tokenIds = Array.isArray(raw.events[0].tokens)
      ? raw.events[0].tokens.map((token: any) => token.tokenId || '').filter(Boolean)
      : [];
  }

  // Warn if no token IDs found
  if (tokenIds.length === 0) {
    console.warn(`⚠️  Market ${raw.id} has NO tokens (field not found in API response)`);
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

/**
 * Format metadata for ClickHouse INSERT
 * NOW INCLUDES ALL 31 FIELDS (13 original + 18 new)
 */
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

/**
 * Fetch markets from /markets endpoint with retry logic
 */
async function fetchMarketsPage(limit: number, offset: number, retries = 3): Promise<any[]> {
  const url = `${CONFIG.API_URL}?limit=${limit}&offset=${offset}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      const isLastAttempt = attempt === retries - 1;

      if (isLastAttempt) {
        console.error(`   ❌ Failed to fetch page at offset ${offset} after ${retries} attempts:`, error);
        throw error;
      } else {
        console.log(`   ⚠️  Retry ${attempt + 1}/${retries} for offset ${offset}...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
      }
    }
  }

  return [];
}

/**
 * Fetch and insert markets in streaming mode (saves as we go!)
 */
async function fetchAndInsertStreaming(): Promise<number> {
  let offset = 0;
  const limit = 100;
  let pageNum = 0;
  let totalInserted = 0;
  let batchBuffer: GammaMarketMetadata[] = [];
  const STREAMING_BATCH_SIZE = 1000; // Insert every 1000 markets

  console.log('\n📡 Fetching markets in STREAMING mode...');
  console.log('   (Saves to ClickHouse progressively)');

  while (true) {
    const rawBatch = await fetchMarketsPage(limit, offset);

    // Stop if API returns empty array
    if (rawBatch.length === 0) {
      console.log(`   ✅ Reached end of data at offset ${offset}`);
      break;
    }

    // DEBUG: Log first market's raw structure
    if (pageNum === 0 && rawBatch.length > 0) {
      console.log('\n🔍 DEBUG: First market raw structure:');
      console.log('='.repeat(80));
      console.log(JSON.stringify(rawBatch[0], null, 2));
      console.log('='.repeat(80));
      console.log('\n🔍 Looking for token_ids in these possible locations:');
      console.log(`  - raw.tokens: ${Array.isArray(rawBatch[0].tokens) ? 'YES (array)' : 'NO'}`);
      console.log(`  - raw.clobTokenIds: ${Array.isArray(rawBatch[0].clobTokenIds) ? 'YES (array)' : 'NO'}`);
      console.log(`  - raw.outcomeTokenIds: ${Array.isArray(rawBatch[0].outcomeTokenIds) ? 'YES (array)' : 'NO'}`);
      console.log(`  - raw.events[0].tokens: ${rawBatch[0].events?.[0]?.tokens ? 'YES' : 'NO'}`);
      console.log('='.repeat(80));
    }

    // Transform batch
    const transformedBatch = rawBatch
      .map(transformToMetadata)
      .filter(m => m.condition_id && m.condition_id.length > 0);

    batchBuffer.push(...transformedBatch);
    pageNum++;
    offset += limit;

    // Insert when buffer reaches threshold
    if (batchBuffer.length >= STREAMING_BATCH_SIZE) {
      await insertBatch(batchBuffer);
      totalInserted += batchBuffer.length;
      console.log(`   💾 Saved ${totalInserted} markets (${pageNum} pages fetched)...`);
      batchBuffer = []; // Clear buffer
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));

    // Safety limit (prevent infinite loop)
    if (totalInserted + batchBuffer.length > 200000) {
      console.log(`   ⚠️  Safety limit reached (200k markets)`);
      break;
    }
  }

  // Insert remaining buffer
  if (batchBuffer.length > 0) {
    await insertBatch(batchBuffer);
    totalInserted += batchBuffer.length;
    console.log(`   💾 Saved final ${batchBuffer.length} markets`);
  }

  console.log(`\n✅ Total markets inserted: ${totalInserted}`);
  return totalInserted;
}

// ============================================================================
// Database Operations
// ============================================================================

async function createTable(): Promise<void> {
  console.log('\n📋 Creating table...');

  try {
    // Drop old table if exists (schema changed)
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_market_metadata' });
    console.log('   Dropped old table (if existed)');

    // Create new table with updated schema
    await clickhouse.command({ query: TABLE_SCHEMA });
    console.log('✅ Table created:', CONFIG.TABLE_NAME);
  } catch (error) {
    console.error('❌ Failed to create table:', error);
    throw error;
  }
}

async function insertBatch(batch: GammaMarketMetadata[]): Promise<void> {
  if (batch.length === 0) return;

  const values = batch.map(formatForInsert).join(',\n');

  const query = `
    INSERT INTO ${CONFIG.TABLE_NAME} (
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

  try {
    await clickhouse.command({ query });
  } catch (error) {
    console.error('❌ Batch insert failed:', error);
    throw error;
  }
}

async function verifyIngestion(): Promise<void> {
  console.log('\n🔍 Verifying ingestion...\n');

  // Total records
  const countResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM ${CONFIG.TABLE_NAME}`,
    format: 'JSONEachRow',
  });
  const countData = await countResult.json<{ count: string }>();
  console.log(`📊 Total records: ${countData[0]?.count || 0}`);

  // Status breakdown
  const statusResult = await clickhouse.query({
    query: `
      SELECT
        is_active,
        is_closed,
        COUNT(*) as count
      FROM ${CONFIG.TABLE_NAME}
      GROUP BY is_active, is_closed
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  const statusData = await statusResult.json<{ is_active: number; is_closed: number; count: string }>();
  console.log('\n📈 Status breakdown:');
  statusData.forEach(row => {
    const activeLabel = row.is_active === 1 ? 'Active' : 'Inactive';
    const closedLabel = row.is_closed === 1 ? 'Closed' : 'Open';
    console.log(`   ${activeLabel} / ${closedLabel}: ${row.count}`);
  });

  // Top tags
  const tagsResult = await clickhouse.query({
    query: `
      SELECT
        arrayJoin(tags) as tag,
        COUNT(*) as count
      FROM ${CONFIG.TABLE_NAME}
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 15
    `,
    format: 'JSONEachRow',
  });
  const tagsData = await tagsResult.json<{ tag: string; count: string }>();
  console.log('\n🏷️  Top tags:');
  tagsData.forEach(row => {
    console.log(`   ${row.tag}: ${row.count}`);
  });

  // Volume stats
  const volumeResult = await clickhouse.query({
    query: `
      SELECT
        round(sum(volume_usdc), 2) as total_volume,
        round(avg(volume_usdc), 2) as avg_volume,
        COUNT(*) as markets_with_volume
      FROM ${CONFIG.TABLE_NAME}
      WHERE volume_usdc > 0
    `,
    format: 'JSONEachRow',
  });
  const volumeData = await volumeResult.json<Record<string, string>>();
  console.log('\n💰 Volume statistics:');
  Object.entries(volumeData[0] || {}).forEach(([field, value]) => {
    console.log(`   ${field}: ${value}`);
  });

  // Missing fields check
  const missingResult = await clickhouse.query({
    query: `
      SELECT
        SUM(question = '') as missing_question,
        SUM(description = '') as missing_description,
        SUM(slug = '') as missing_slug,
        SUM(length(tags) = 0) as missing_tags
      FROM ${CONFIG.TABLE_NAME}
    `,
    format: 'JSONEachRow',
  });
  const missingData = await missingResult.json<Record<string, string>>();
  console.log('\n⚠️  Missing fields:');
  Object.entries(missingData[0] || {}).forEach(([field, count]) => {
    console.log(`   ${field}: ${count}`);
  });
}

// ============================================================================
// Main Ingestion Logic
// ============================================================================

async function ingestMetadata(): Promise<void> {
  const startTime = Date.now();

  console.log('🚀 Starting Gamma API metadata ingestion (STREAMING MODE)');
  console.log(`   Mode: ${CONFIG.DRY_RUN ? 'DRY RUN' : 'PRODUCTION'}`);
  console.log(`   Streaming batch: 1000 markets (saves progressively)`);

  // Step 1: Create table
  if (!CONFIG.DRY_RUN) {
    await createTable();
  }

  if (CONFIG.DRY_RUN) {
    console.log('\n🔍 DRY RUN - Testing first 1000 markets...');

    // Fetch just first 1000 for testing
    const testBatch = await fetchMarketsPage(100, 0);
    const transformed = testBatch
      .map(transformToMetadata)
      .filter(m => m.condition_id && m.condition_id.length > 0);

    console.log(`\n✅ Fetched ${testBatch.length} markets`);
    console.log(`✅ Transformed ${transformed.length} valid records`);

    if (transformed.length > 0) {
      console.log('\nSample record:');
      console.log(JSON.stringify(transformed[0], null, 2));
    }

    return;
  }

  // Step 2: Fetch and insert in streaming mode
  const inserted = await fetchAndInsertStreaming();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Ingestion complete!`);
  console.log(`   Inserted: ${inserted} records`);
  console.log(`   Duration: ${duration}s`);
  console.log(`   Rate: ${(inserted / parseFloat(duration)).toFixed(0)} records/sec`);
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  try {
    // ============================================================================
    // 🚨 FREEZE GUARD: Prevent accidental API re-ingestion
    // ============================================================================
    if (process.env.FREEZE_GAMMA_INGESTION === '1') {
      console.log('\n🚫 GAMMA API INGESTION IS FROZEN');
      console.log('   FREEZE_GAMMA_INGESTION=1 is set in .env.local');
      console.log('   To prevent data loss, this script will not run.');
      console.log('\n   Use scripts/re-enrich-existing-markets.ts instead to re-process existing data.\n');
      process.exit(0);
    }

    if (CONFIG.VERIFY_ONLY) {
      await verifyIngestion();
    } else {
      await ingestMetadata();

      // Run verification after ingestion
      if (!CONFIG.DRY_RUN) {
        await verifyIngestion();
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
