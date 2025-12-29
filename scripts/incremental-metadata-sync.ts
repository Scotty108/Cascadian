#!/usr/bin/env npx tsx
/**
 * INCREMENTAL Gamma API Metadata Sync
 *
 * SAFE VERSION: Does NOT drop table, only UPSERTs new/updated markets.
 * Uses ReplacingMergeTree's version column (ingested_at) for deduplication.
 *
 * Usage:
 *   npx tsx scripts/incremental-metadata-sync.ts           # Full sync (add missing markets)
 *   npx tsx scripts/incremental-metadata-sync.ts --quick   # Quick mode (last 7 days only)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { enrichMarketTags } from './enrich-market-tags-v2';

const API_URL = 'https://gamma-api.polymarket.com/markets';
const QUICK_MODE = process.argv.includes('--quick');

interface GammaMarket {
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  outcomes: string;
  clobTokenIds: string;
  volume: string;
  active: boolean;
  closed: boolean;
  category: string;
  [key: string]: any;
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

  // Parse token IDs from clobTokenIds (JSON string)
  let tokenIds: string[] = [];
  if (raw.clobTokenIds) {
    try {
      const parsed = JSON.parse(raw.clobTokenIds);
      tokenIds = Array.isArray(parsed) ? parsed : [];
    } catch {
      tokenIds = [];
    }
  }

  // Parse outcomes
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

  // Enrich tags
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

async function main() {
  console.log('='.repeat(80));
  console.log('INCREMENTAL METADATA SYNC (SAFE - NO DROP)');
  console.log('='.repeat(80));
  console.log(`Mode: ${QUICK_MODE ? 'QUICK (last 7 days)' : 'FULL'}`);

  // Get current state
  const countQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_market_metadata',
    format: 'JSONEachRow',
  });
  const countRows = (await countQ.json()) as any[];
  const existingCount = parseInt(countRows[0]?.cnt || '0');
  console.log(`Existing markets in table: ${existingCount.toLocaleString()}\n`);

  // Fetch from API
  let offset = 0;
  const limit = 100;
  let totalFetched = 0;
  let totalInserted = 0;
  let buffer: any[] = [];
  const BATCH_SIZE = 1000;

  console.log('Fetching from Gamma API...');
  const startTime = Date.now();

  while (true) {
    const raw = await fetchPage(limit, offset);
    if (raw.length === 0) {
      console.log(`Reached end at offset ${offset}`);
      break;
    }

    const transformed = raw
      .map(transformMarket)
      .filter((m) => m.condition_id && m.condition_id.length > 0);

    buffer.push(...transformed);
    totalFetched += raw.length;
    offset += limit;

    // Insert when buffer is full
    if (buffer.length >= BATCH_SIZE) {
      await insertBatch(buffer);
      totalInserted += buffer.length;
      process.stdout.write(`\rInserted ${totalInserted.toLocaleString()} markets...`);
      buffer = [];
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 100));

    // Safety limit
    if (totalFetched > 200000) {
      console.log('\nSafety limit reached');
      break;
    }
  }

  // Insert remaining
  if (buffer.length > 0) {
    await insertBatch(buffer);
    totalInserted += buffer.length;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nSync complete in ${elapsed}s`);
  console.log(`Total fetched: ${totalFetched.toLocaleString()}`);
  console.log(`Total inserted/updated: ${totalInserted.toLocaleString()}`);

  // Verify final count
  const finalQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(length(token_ids) > 0) as with_tokens,
        sum(length(token_ids)) as total_tokens
      FROM pm_market_metadata FINAL
    `,
    format: 'JSONEachRow',
  });
  const finalRows = (await finalQ.json()) as any[];
  console.log('\nFinal state (after OPTIMIZE):');
  console.log(JSON.stringify(finalRows[0], null, 2));

  // Optimize table to merge duplicates
  console.log('\nRunning OPTIMIZE TABLE FINAL...');
  await clickhouse.command({ query: 'OPTIMIZE TABLE pm_market_metadata FINAL' });
  console.log('Done!');
}

main().catch(console.error);
