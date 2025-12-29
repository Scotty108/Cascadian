/**
 * Canonical Event Ingestion - Mirror Polymarket's Taxonomy
 *
 * Fetches events from Polymarket Gamma API and stores them exactly as-is.
 * NO interpretation, NO mapping - pure mirroring of Polymarket's categories and tags.
 *
 * Schema: pm_event_metadata
 * - event_id: Polymarket event ID
 * - canonical_category: event.category (as-is from Polymarket)
 * - canonical_tags: event.tags[].label (as-is from Polymarket)
 * - series_titles: event.series[].title (NBA, UFC, etc.)
 * - market_ids: Array of market IDs under this event
 */

import 'dotenv/config';
import { clickhouse } from '../lib/clickhouse/client';

const API_URL = 'https://gamma-api.polymarket.com/events';
const BATCH_SIZE = 500;

interface PolymarketTag {
  id: string;
  label: string;
  slug: string;
}

interface PolymarketSeries {
  id: string;
  title: string;
  slug: string;
}

interface PolymarketEvent {
  id: string;
  category: string;
  tags: PolymarketTag[];
  series: PolymarketSeries[];
  markets: Array<{ id: string }>;
}

interface EventMetadata {
  event_id: string;
  canonical_category: string;
  canonical_tags: string[];
  series_titles: string[];
  market_ids: string[];
  ingested_at: number;
}

// ============================================================================
// Table Schema
// ============================================================================

const TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS pm_event_metadata (
  event_id String,
  canonical_category String,
  canonical_tags Array(String),
  series_titles Array(String),
  market_ids Array(String),
  ingested_at DateTime64(3, 'UTC'),

  PRIMARY KEY (event_id)
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (event_id);
`;

// ============================================================================
// Transform Functions
// ============================================================================

function transformEvent(raw: any): EventMetadata {
  // NO MAPPING - store Polymarket's category exactly as-is
  const canonical_category = raw.category || 'Uncategorized';

  // Extract tag labels exactly as Polymarket provides them
  const canonical_tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    for (const tag of raw.tags) {
      if (tag && typeof tag === 'object' && tag.label) {
        canonical_tags.push(tag.label);
      }
    }
  }

  // Extract series titles (NBA, UFC, etc.)
  const series_titles: string[] = [];
  if (Array.isArray(raw.series)) {
    for (const series of raw.series) {
      if (series && typeof series === 'object' && series.title) {
        series_titles.push(series.title);
      }
    }
  }

  // Extract market IDs
  const market_ids: string[] = [];
  if (Array.isArray(raw.markets)) {
    for (const market of raw.markets) {
      if (market && market.id) {
        market_ids.push(market.id.toString());
      }
    }
  }

  return {
    event_id: raw.id.toString(),
    canonical_category,
    canonical_tags,
    series_titles,
    market_ids,
    ingested_at: Date.now(),
  };
}

function formatForInsert(event: EventMetadata): string {
  const escape = (str: string) => str.replace(/'/g, "\\'").replace(/\n/g, ' ');

  const tags = `[${event.canonical_tags.map(t => `'${escape(t)}'`).join(', ')}]`;
  const series = `[${event.series_titles.map(s => `'${escape(s)}'`).join(', ')}]`;
  const markets = `[${event.market_ids.map(id => `'${escape(id)}'`).join(', ')}]`;

  return `(
    '${escape(event.event_id)}',
    '${escape(event.canonical_category)}',
    ${tags},
    ${series},
    ${markets},
    ${event.ingested_at}
  )`;
}

// ============================================================================
// API Fetching
// ============================================================================

async function fetchEvents(offset: number = 0, limit: number = 100): Promise<any[]> {
  const url = `${API_URL}?limit=${limit}&offset=${offset}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchAllEvents(): Promise<EventMetadata[]> {
  const allEvents: EventMetadata[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  console.log('📡 Fetching all events from Polymarket API...');

  while (hasMore) {
    const batch = await fetchEvents(offset, limit);

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    const transformed = batch.map(transformEvent);
    allEvents.push(...transformed);

    offset += limit;
    console.log(`  Fetched ${allEvents.length} events...`);

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`✅ Total events fetched: ${allEvents.length}`);
  return allEvents;
}

// ============================================================================
// Database Operations
// ============================================================================

async function createTable(): Promise<void> {
  console.log('📋 Creating event metadata table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_event_metadata' });
  await clickhouse.command({ query: TABLE_SCHEMA });
  console.log('✅ Table created: pm_event_metadata');
}

async function insertBatch(batch: EventMetadata[]): Promise<void> {
  if (batch.length === 0) return;

  const values = batch.map(formatForInsert).join(',\n');

  const query = `
    INSERT INTO pm_event_metadata (
      event_id,
      canonical_category,
      canonical_tags,
      series_titles,
      market_ids,
      ingested_at
    ) VALUES
    ${values}
  `;

  await clickhouse.command({ query });
}

// ============================================================================
// Main Ingestion
// ============================================================================

async function ingestEvents(): Promise<void> {
  const startTime = Date.now();

  console.log('\n🚀 CANONICAL EVENT INGESTION');
  console.log('   Strategy: Mirror Polymarket taxonomy exactly');
  console.log('   NO mapping, NO interpretation');
  console.log('='.repeat(60));

  try {
    // Create table
    await createTable();

    // Fetch all events
    const events = await fetchAllEvents();

    // Insert in batches
    console.log(`\n💾 Inserting ${events.length} events in batches of ${BATCH_SIZE}...`);
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      await insertBatch(batch);
      console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} events`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('✅ INGESTION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Events ingested:     ${events.length}`);
    console.log(`Duration:            ${duration}s`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Ingestion failed:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  ingestEvents()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
