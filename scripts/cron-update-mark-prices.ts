/**
 * CRON JOB: Update Mark Prices for Open Markets Only
 *
 * Efficiently fetches current prices for ONLY open/active markets (~22K)
 * instead of all 300K+ markets. Uses Gamma API with closed=false filter.
 *
 * Recommended cron: Every 15 minutes (*/15 * * * *)
 *
 * API efficiency:
 * - Old approach: ~600 API calls (all 300K markets)
 * - New approach: ~45 API calls (only 22K open markets)
 *
 * For closed/resolved markets, use pm_condition_resolutions
 * (winning outcome = 1.0, losing = 0.0)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const PAGE_SIZE = 500;
const LOG_PREFIX = () => `[${new Date().toISOString()}]`;

function log(msg: string) {
  console.log(`${LOG_PREFIX()} ${msg}`);
}

interface MarketData {
  conditionId?: string;
  condition_id?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  updatedAt?: string;
}

async function fetchOpenMarkets(): Promise<MarketData[]> {
  const allMarkets: MarketData[] = [];
  let offset = 0;
  let hasMore = true;

  log('Fetching open markets from Gamma API (closed=false)...');

  while (hasMore) {
    const url = `${GAMMA_API}?closed=false&limit=${PAGE_SIZE}&offset=${offset}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        log(`  API error at offset ${offset}: ${res.status}`);
        break;
      }

      const data: MarketData[] = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        hasMore = false;
      } else {
        allMarkets.push(...data);
        offset += PAGE_SIZE;

        if (offset % 5000 === 0) {
          log(`  Fetched ${allMarkets.length} markets...`);
        }

        // Small delay to be nice to the API
        await new Promise(r => setTimeout(r, 100));

        if (data.length < PAGE_SIZE) {
          hasMore = false;
        }
      }
    } catch (err) {
      log(`  Fetch error at offset ${offset}: ${err}`);
      break;
    }
  }

  log(`  Total open markets fetched: ${allMarkets.length}`);
  return allMarkets;
}

function normalizeConditionId(id: string | undefined): string {
  if (!id) return '';
  return id.toLowerCase().replace(/^0x/, '');
}

function parseOutcomePrices(raw: string | undefined): number[] {
  if (!raw) return [];
  try {
    let parsed = raw;
    // Handle double-encoded JSON: "\"[...]\""
    if (parsed.startsWith('"') && parsed.endsWith('"')) {
      parsed = JSON.parse(parsed);
    }
    const arr = JSON.parse(parsed);
    if (!Array.isArray(arr)) return [];
    return arr.map((p: string) => parseFloat(p)).filter((p: number) => !isNaN(p));
  } catch {
    return [];
  }
}

async function updateMarkPrices() {
  const startTime = Date.now();
  log('=== Starting Mark Price Update (Open Markets Only) ===');

  // Step 1: Fetch open markets from API
  const openMarkets = await fetchOpenMarkets();

  if (openMarkets.length === 0) {
    log('No open markets found. Exiting.');
    return;
  }

  // Step 2: Parse prices into rows
  log('Parsing outcome prices...');

  const rows: Array<{
    condition_id: string;
    outcome_index: number;
    mark_price: number;
    last_trade_time: Date;
    trade_count: number;
  }> = [];

  const now = new Date();
  let parseErrors = 0;

  for (const market of openMarkets) {
    const conditionId = normalizeConditionId(market.conditionId || market.condition_id);
    if (!conditionId) continue;

    const prices = parseOutcomePrices(market.outcomePrices);
    if (prices.length === 0) {
      parseErrors++;
      continue;
    }

    const lastUpdate = market.updatedAt ? new Date(market.updatedAt) : now;

    for (let i = 0; i < prices.length; i++) {
      rows.push({
        condition_id: conditionId,
        outcome_index: i,
        mark_price: prices[i],
        last_trade_time: lastUpdate,
        trade_count: 0,
      });
    }
  }

  log(`  Parsed ${rows.length} price rows from ${openMarkets.length} markets`);
  if (parseErrors > 0) {
    log(`  (${parseErrors} markets had unparseable prices)`);
  }

  if (rows.length === 0) {
    log('No valid price rows. Exiting.');
    return;
  }

  // Step 3: Rebuild the mark price table
  log('Updating pm_latest_mark_price_v1...');

  // Truncate existing data
  await clickhouse.command({
    query: 'TRUNCATE TABLE pm_latest_mark_price_v1',
  });
  log('  Truncated old data');

  // Insert new rows in batches
  const BATCH_SIZE = 10000;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await clickhouse.insert({
      table: 'pm_latest_mark_price_v1',
      values: batch,
      format: 'JSONEachRow',
    });

    inserted += batch.length;
  }

  log(`  Inserted ${inserted} rows`);

  // Step 4: Verify
  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt, uniq(condition_id) as conditions FROM pm_latest_mark_price_v1',
    format: 'JSONEachRow',
  });
  const stats = (await countResult.json()) as Array<{ cnt: string; conditions: string }>;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log('=== Mark Price Update Complete ===');
  log(`  Rows: ${stats[0]?.cnt || 0}`);
  log(`  Unique conditions: ${stats[0]?.conditions || 0}`);
  log(`  Open markets: ${openMarkets.length}`);
  log(`  API calls: ~${Math.ceil(openMarkets.length / PAGE_SIZE)}`);
  log(`  Duration: ${elapsed}s`);
}

// Main execution
updateMarkPrices()
  .then(() => {
    log('Cron job finished successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error(`${LOG_PREFIX()} Error:`, err);
    process.exit(1);
  });
