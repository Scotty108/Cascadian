// Mark Price Update Cron Job
//
// Efficiently fetches current prices for ONLY open/active markets (~22K)
// instead of all 300K+ markets. Uses Gamma API with closed=false filter.
//
// Schedule: Every 15 minutes
// Runtime: ~30 seconds
//
// API efficiency:
// - Old approach: ~600 API calls (all 300K markets)
// - New approach: ~45 API calls (only 22K open markets)

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes max

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const PAGE_SIZE = 500;

interface MarketData {
  conditionId?: string;
  condition_id?: string;
  outcomePrices?: string;
  updatedAt?: string;
}

interface UpdateStats {
  marketsFound: number;
  rowsInserted: number;
  parseErrors: number;
  apiCalls: number;
  duration: number;
}

function normalizeConditionId(id: string | undefined): string {
  if (!id) return '';
  return id.toLowerCase().replace(/^0x/, '');
}

function parseOutcomePrices(raw: string | undefined): number[] {
  if (!raw) return [];
  try {
    let parsed = raw;
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

async function fetchOpenMarkets(): Promise<MarketData[]> {
  const allMarkets: MarketData[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${GAMMA_API}?closed=false&limit=${PAGE_SIZE}&offset=${offset}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`[mark-prices] API error at offset ${offset}: ${res.status}`);
        break;
      }

      const data: MarketData[] = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        hasMore = false;
      } else {
        allMarkets.push(...data);
        offset += PAGE_SIZE;

        // Small delay to be nice to the API
        await new Promise((r) => setTimeout(r, 50));

        if (data.length < PAGE_SIZE) {
          hasMore = false;
        }
      }
    } catch (err) {
      console.log(`[mark-prices] Fetch error at offset ${offset}:`, err);
      break;
    }
  }

  return allMarkets;
}

async function updateMarkPrices(): Promise<UpdateStats> {
  const startTime = Date.now();
  console.log('[mark-prices] Starting update for open markets...');

  // Step 1: Fetch open markets from API
  const openMarkets = await fetchOpenMarkets();
  console.log(`[mark-prices] Fetched ${openMarkets.length} open markets`);

  if (openMarkets.length === 0) {
    throw new Error('No open markets found from API');
  }

  // Step 2: Parse prices into rows
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

  console.log(`[mark-prices] Parsed ${rows.length} price rows (${parseErrors} parse errors)`);

  if (rows.length === 0) {
    throw new Error('No valid price rows parsed');
  }

  // Step 3: Rebuild the mark price table
  await clickhouse.command({
    query: 'TRUNCATE TABLE pm_latest_mark_price_v1',
  });

  // Insert in batches
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

  const duration = Date.now() - startTime;
  const apiCalls = Math.ceil(openMarkets.length / PAGE_SIZE);

  console.log(`[mark-prices] Complete: ${inserted} rows, ${apiCalls} API calls, ${duration}ms`);

  return {
    marketsFound: openMarkets.length,
    rowsInserted: inserted,
    parseErrors,
    apiCalls,
    duration,
  };
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronRequest(request, 'update-mark-prices');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  try {
    const stats = await updateMarkPrices();

    return NextResponse.json({
      success: true,
      message: 'Mark prices updated for open markets',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[mark-prices] Update failed:', error);
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
