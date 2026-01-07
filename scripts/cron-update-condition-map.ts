/**
 * CRON JOB: Update Condition Map Pipeline
 *
 * Runs the full update pipeline:
 * 1. Incremental metadata sync from Gamma API
 * 2. Rebuild pm_token_to_condition_map_v5
 * 3. Report coverage stats
 *
 * Recommended cron: Every 6 hours (0 0,6,12,18 * * *)
 * Or use Vercel Cron / GitHub Actions for hosted execution.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { enrichMarketTags } from './enrich-market-tags-v2';

const API_URL = 'https://gamma-api.polymarket.com/markets';
const LOG_PREFIX = `[${new Date().toISOString()}]`;

function log(msg: string) {
  console.log(`${LOG_PREFIX} ${msg}`);
}

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

function transformMarket(raw: any) {
  const isActive = raw.active && !raw.closed;
  const conditionId = raw.conditionId || raw.condition_id || '';
  const volume = parseFloat(raw.volume || raw.volumeNum || '0');

  let tokenIds: string[] = [];
  if (raw.clobTokenIds) {
    try {
      const parsed = JSON.parse(raw.clobTokenIds);
      tokenIds = Array.isArray(parsed) ? parsed : [];
    } catch {
      tokenIds = [];
    }
  }

  let outcomes: string[] = [];
  if (typeof raw.outcomes === 'string' && raw.outcomes) {
    try {
      const parsed = JSON.parse(raw.outcomes);
      outcomes = Array.isArray(parsed) ? parsed : [];
    } catch {
      outcomes = [];
    }
  } else if (Array.isArray(raw.outcomes)) {
    outcomes = raw.outcomes;
  }

  const eventTags: string[] = [];
  if (Array.isArray(raw.events?.[0]?.tags)) {
    for (const tag of raw.events[0].tags) {
      if (tag?.label) eventTags.push(tag.label);
    }
  }
  const enriched = enrichMarketTags(raw.question || '', eventTags, raw.slug || '');

  return {
    condition_id: normalizeConditionId(conditionId),
    market_id: raw.id || '',
    slug: raw.slug || '',
    question: raw.question || '',
    outcome_label: raw.groupItemTitle || raw.title || '',
    description: raw.description || '',
    image_url: raw.image || raw.icon || '',
    tags: enriched.enrichedTags,
    category: enriched.category,
    volume_usdc: volume,
    is_active: isActive ? 1 : 0,
    is_closed: raw.closed ? 1 : 0,
    end_date: parseDate(raw.endDate),
    ingested_at: Date.now(),
    liquidity_usdc: parseFloat(raw.liquidity || '0'),
    outcomes,
    outcome_prices: raw.outcomePrices ? JSON.stringify(raw.outcomePrices) : '',
    token_ids: tokenIds,
    winning_outcome: raw.winningOutcome || '',
    resolution_source: raw.resolutionSource || '',
    enable_order_book: raw.enableOrderBook ? 1 : 0,
    order_price_min_tick_size: parseFloat(raw.orderPriceMinTickSize || '0'),
    notifications_enabled: raw.notificationsEnabled ? 1 : 0,
    event_id: raw.events?.[0]?.id || '',
    group_slug: raw.events?.[0]?.slug || raw.slug || '',
    rewards_min_size: parseFloat(raw.rewardsMinSize || '0'),
    rewards_max_spread: parseFloat(raw.rewardsMaxSpread || '0'),
    spread: parseFloat(raw.spread || '0'),
    best_bid: parseFloat(raw.bestBid || '0'),
    best_ask: parseFloat(raw.bestAsk || '0'),
    start_date: parseDate(raw.startDate),
    created_at: parseDate(raw.createdAt),
    updated_at: parseDate(raw.updatedAt),
    market_type: raw.marketType || 'normal',
    format_type: raw.formatType || '',
    lower_bound: raw.lowerBound || '',
    upper_bound: raw.upperBound || '',
    volume_24hr: parseFloat(raw.volume24hr || '0'),
    volume_1wk: parseFloat(raw.volume1wk || '0'),
    volume_1mo: parseFloat(raw.volume1mo || '0'),
    price_change_1d: parseFloat(raw.oneDayPriceChange || '0'),
    price_change_1w: parseFloat(raw.oneWeekPriceChange || '0'),
    series_slug: raw.events?.[0]?.seriesSlug || '',
    series_data: raw.events?.[0]?.series?.[0] ? JSON.stringify(raw.events[0].series[0]) : '',
    comment_count: parseInt(raw.events?.[0]?.commentCount || '0'),
    is_restricted: raw.restricted ? 1 : 0,
    is_archived: raw.archived ? 1 : 0,
    wide_format: raw.wideFormat ? 1 : 0,
  };
}

function formatForInsert(m: any): string {
  const escape = (str: string) => str.replace(/'/g, "\\'").replace(/\n/g, ' ');
  const tags = `[${m.tags.map((t: string) => `'${escape(t)}'`).join(', ')}]`;
  const outcomes = `[${m.outcomes.map((o: string) => `'${escape(o)}'`).join(', ')}]`;
  const tokenIds = `[${m.token_ids.map((id: string) => `'${escape(id)}'`).join(', ')}]`;

  const startDate = m.start_date ? `'${m.start_date.toISOString()}'` : 'NULL';
  const endDate = m.end_date ? `'${m.end_date.toISOString()}'` : 'NULL';
  const createdAt = m.created_at ? `'${m.created_at.toISOString()}'` : 'NULL';
  const updatedAt = m.updated_at ? `'${m.updated_at.toISOString()}'` : 'NULL';

  return `(
    '${escape(m.condition_id)}', '${escape(m.market_id)}', '${escape(m.slug)}',
    '${escape(m.question)}', '${escape(m.outcome_label)}', '${escape(m.description)}',
    '${escape(m.image_url)}', ${tags}, '${escape(m.category)}', ${m.volume_usdc},
    ${m.is_active}, ${m.is_closed}, ${endDate}, ${m.ingested_at}, ${m.liquidity_usdc},
    ${outcomes}, '${escape(m.outcome_prices)}', ${tokenIds},
    '${escape(m.winning_outcome)}', '${escape(m.resolution_source)}',
    ${m.enable_order_book}, ${m.order_price_min_tick_size}, ${m.notifications_enabled},
    '${escape(m.event_id)}', '${escape(m.group_slug)}',
    ${m.rewards_min_size}, ${m.rewards_max_spread}, ${m.spread}, ${m.best_bid}, ${m.best_ask},
    '${escape(m.market_type)}', '${escape(m.format_type)}',
    '${escape(m.lower_bound)}', '${escape(m.upper_bound)}',
    ${m.volume_24hr}, ${m.volume_1wk}, ${m.volume_1mo},
    ${m.price_change_1d}, ${m.price_change_1w},
    '${escape(m.series_slug)}', '${escape(m.series_data)}',
    ${m.comment_count}, ${m.is_restricted}, ${m.is_archived}, ${m.wide_format},
    ${startDate}, ${createdAt}, ${updatedAt}
  )`;
}

async function fetchPage(limit: number, offset: number): Promise<any[]> {
  const url = `${API_URL}?limit=${limit}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function insertBatch(batch: any[]): Promise<void> {
  if (batch.length === 0) return;
  const values = batch.map(formatForInsert).join(',\n');
  const query = `
    INSERT INTO pm_market_metadata (
      condition_id, market_id, slug, question, outcome_label, description,
      image_url, tags, category, volume_usdc, is_active, is_closed,
      end_date, ingested_at, liquidity_usdc, outcomes, outcome_prices, token_ids,
      winning_outcome, resolution_source, enable_order_book, order_price_min_tick_size,
      notifications_enabled, event_id, group_slug, rewards_min_size, rewards_max_spread,
      spread, best_bid, best_ask, market_type, format_type, lower_bound, upper_bound,
      volume_24hr, volume_1wk, volume_1mo, price_change_1d, price_change_1w,
      series_slug, series_data, comment_count, is_restricted, is_archived, wide_format,
      start_date, created_at, updated_at
    ) VALUES ${values}
  `;
  await clickhouse.command({ query });
}

async function getLastSyncTime(): Promise<Date | null> {
  try {
    const q = await clickhouse.query({
      query: `SELECT last_success_at FROM pm_sync_status FINAL WHERE sync_type = 'metadata_sync'`,
      format: 'JSONEachRow',
    });
    const rows = (await q.json()) as any[];
    if (rows.length > 0 && rows[0].last_success_at) {
      return new Date(rows[0].last_success_at);
    }
  } catch {
    // Table might not exist yet
  }
  return null;
}

async function recordSyncStatus(
  recordsSynced: number,
  coveragePct: number,
  durationMs: number,
  errorMsg: string = ''
): Promise<void> {
  await clickhouse.command({
    query: `
      INSERT INTO pm_sync_status (sync_type, last_success_at, records_synced, coverage_pct, duration_ms, error_message)
      VALUES ('metadata_sync', now64(3), ${recordsSynced}, ${coveragePct}, ${durationMs}, '${errorMsg.replace(/'/g, "''")}')
    `,
  });
}

async function syncMetadata(deltaSince?: Date): Promise<number> {
  let offset = 0;
  const limit = 100;
  let totalInserted = 0;
  let buffer: any[] = [];
  const BATCH_SIZE = 1000;

  // Add updated filter for delta sync
  const baseUrl = deltaSince
    ? `${API_URL}?updated_since=${deltaSince.toISOString()}`
    : API_URL;

  if (deltaSince) {
    log(`  Delta sync: fetching markets updated since ${deltaSince.toISOString()}`);
  }

  while (true) {
    const url = deltaSince
      ? `${baseUrl}&limit=${limit}&offset=${offset}`
      : `${API_URL}?limit=${limit}&offset=${offset}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;

    const transformed = raw
      .map(transformMarket)
      .filter((m) => m.condition_id && m.condition_id.length > 0);

    buffer.push(...transformed);
    offset += limit;

    if (buffer.length >= BATCH_SIZE) {
      await insertBatch(buffer);
      totalInserted += buffer.length;
      buffer = [];
    }

    await new Promise((r) => setTimeout(r, 100));

    // No hard limit for delta sync, but limit full sync
    if (!deltaSince && totalInserted > 300000) break;
  }

  if (buffer.length > 0) {
    await insertBatch(buffer);
    totalInserted += buffer.length;
  }

  return totalInserted;
}

async function rebuildV5(): Promise<{ before: number; after: number }> {
  // Get current count
  const beforeQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const beforeRows = (await beforeQ.json()) as any[];
  const before = parseInt(beforeRows[0]?.cnt || '0');

  // Create new table
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

  // Get new count
  const afterQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5_new',
    format: 'JSONEachRow',
  });
  const afterRows = (await afterQ.json()) as any[];
  const after = parseInt(afterRows[0]?.cnt || '0');

  // Safety check
  if (after < before * 0.9) {
    log(`❌ New table too small (${after} vs ${before}). Aborting swap.`);
    return { before, after };
  }

  // Atomic swap
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5 TO pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5_new TO pm_token_to_condition_map_v5' });
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });

  return { before, after };
}

async function getCoverageStats(): Promise<{ total: number; mapped: number; pct: number }> {
  const q = await clickhouse.query({
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
  const rows = (await q.json()) as any[];
  const total = parseInt(rows[0]?.total || '0');
  const mapped = parseInt(rows[0]?.mapped || '0');
  const pct = total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0;
  return { total, mapped, pct };
}

const COVERAGE_THRESHOLD = 98.0;

async function main() {
  log('='.repeat(60));
  log('CRON: Condition Map Update Pipeline');
  log('='.repeat(60));

  const startTime = Date.now();
  let inserted = 0;
  let coveragePct = 0;

  try {
    // Step 0: Check last sync time for delta sync
    const lastSync = await getLastSyncTime();
    const useDelta = lastSync !== null;

    // Step 1: Sync metadata
    log('Step 1: Syncing metadata from Gamma API...');
    const startSync = Date.now();
    inserted = await syncMetadata(useDelta ? lastSync : undefined);
    const syncDuration = ((Date.now() - startSync) / 1000).toFixed(1);
    log(`  Synced ${inserted.toLocaleString()} markets in ${syncDuration}s`);

    // Optimize metadata table
    log('  Optimizing metadata table...');
    await clickhouse.command({ query: 'OPTIMIZE TABLE pm_market_metadata FINAL' });

    // Step 2: Rebuild V5 map
    log('Step 2: Rebuilding token map V5...');
    const startV5 = Date.now();
    const { before, after } = await rebuildV5();
    const v5Duration = ((Date.now() - startV5) / 1000).toFixed(1);
    log(`  V5: ${before.toLocaleString()} → ${after.toLocaleString()} tokens in ${v5Duration}s`);

    // Step 3: Coverage stats
    log('Step 3: Checking coverage...');
    const coverage = await getCoverageStats();
    coveragePct = coverage.pct;
    log(`  Last 14d: ${coverage.mapped}/${coverage.total} tokens mapped (${coverage.pct}%)`);

    // Step 4: Coverage threshold check
    if (coverage.pct < COVERAGE_THRESHOLD) {
      log(`\n⚠️  ALERT: Coverage ${coverage.pct}% is below threshold ${COVERAGE_THRESHOLD}%!`);
      log(`   This may indicate missing markets in metadata.`);
      log(`   Consider running a full sync: npx tsx scripts/sync-metadata-robust.ts`);
    }

    // Step 5: Record sync status
    const durationMs = Date.now() - startTime;
    await recordSyncStatus(inserted, coveragePct, durationMs);
    log(`  Recorded sync status to pm_sync_status`);

    // Summary
    log('');
    log('✅ Pipeline complete!');
    log(`   Mode: ${useDelta ? 'Delta' : 'Full'} sync`);
    log(`   Metadata: ${inserted.toLocaleString()} markets synced`);
    log(`   Token Map: ${after.toLocaleString()} tokens`);
    log(`   Coverage: ${coverage.pct}%`);
    log(`   Duration: ${(durationMs / 1000).toFixed(1)}s`);

    process.exit(0);
  } catch (error: any) {
    log(`❌ FAILED: ${error.message}`);
    // Record failure
    try {
      const durationMs = Date.now() - startTime;
      await recordSyncStatus(inserted, coveragePct, durationMs, error.message);
    } catch {
      // Ignore recording errors
    }
    console.error(error);
    process.exit(1);
  }
}

main();
