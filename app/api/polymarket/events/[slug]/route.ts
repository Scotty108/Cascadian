/**
 * Polymarket Event Detail API Endpoint
 *
 * Fetches a single event by slug - uses ClickHouse first, falls back to Polymarket API
 * Returns full event data including all nested markets
 *
 * GET /api/polymarket/events/[slug]
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { extractCategoryFromTags } from '@/lib/polymarket/utils'

interface MarketRow {
  condition_id: string;
  question: string;
  outcomes: string[];
  outcome_prices: string;
  category: string;
  image_url: string;
  end_date: string;
  is_closed: number;
  volume_total: number;
  liquidity_usdc: number;
  token_ids: string[];
  event_id: string;
  group_slug: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  try {
    console.log(`[Event Detail API] Looking up event for slug: ${slug}`)

    // Step 1: Query ClickHouse to find event by group_slug or event_id
    const query = `
      SELECT
        condition_id,
        question,
        outcomes,
        outcome_prices,
        category,
        image_url,
        end_date,
        is_closed,
        volume_total,
        liquidity_usdc,
        token_ids,
        event_id,
        group_slug
      FROM pm_market_metadata
      WHERE group_slug = {slug:String} OR event_id = {slug:String}
      ORDER BY volume_total DESC
    `;

    const result = await clickhouse.query({
      query,
      query_params: { slug },
      format: 'JSONEachRow',
    });

    const markets = (await result.json()) as MarketRow[];

    if (!markets || markets.length === 0) {
      console.log(`[Event Detail API] Event not found in ClickHouse: ${slug}`)

      // Try fetching directly from Polymarket as fallback
      try {
        const pmResponse = await fetch(`https://gamma-api.polymarket.com/events/${slug}`, {
          headers: { 'Accept': 'application/json' },
        });

        if (pmResponse.ok) {
          const event = await pmResponse.json();
          const category = extractCategoryFromTags(event.tags || []);
          return NextResponse.json({
            success: true,
            data: {
              ...event,
              category,
              isMultiOutcome: event.negRisk === true && event.markets?.length > 2,
              marketCount: event.markets?.length || 0,
            },
          });
        }
      } catch (e) {
        // Fallback failed, return 404
      }

      return NextResponse.json(
        {
          success: false,
          error: 'This event is no longer available. It may have closed, been archived, or the link may be incorrect.',
        },
        { status: 404 }
      )
    }

    // Step 2: Build event object from markets
    const firstMarket = markets[0];
    const eventId = firstMarket.event_id;
    const groupSlug = firstMarket.group_slug;

    // Convert group_slug to readable title
    const title = groupSlug
      ? groupSlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      : markets[0].question?.split('?')[0] || 'Untitled Event';

    // Calculate totals
    const totalVolume = markets.reduce((sum, m) => sum + (m.volume_total || 0), 0);
    const totalLiquidity = markets.reduce((sum, m) => sum + (m.liquidity_usdc || 0), 0);
    const activeMarkets = markets.filter(m => !m.is_closed).length;

    // Find latest end date
    const endDates = markets.map(m => m.end_date).filter(Boolean);
    const endDate = endDates.length > 0 ? endDates.sort().pop() : null;

    // Transform markets to expected format
    const transformedMarkets = markets.map(m => ({
      id: m.condition_id,
      question: m.question,
      active: !m.is_closed,
      closed: !!m.is_closed,
      outcomes: m.outcomes || ['Yes', 'No'],
      outcomePrices: m.outcome_prices || '[0.5, 0.5]',
      clobTokenIds: JSON.stringify(m.token_ids || []),
      conditionId: m.condition_id,
      image: m.image_url,
      slug: m.condition_id,
    }));

    const enrichedEvent = {
      id: eventId,
      slug: groupSlug || eventId,
      title,
      description: markets[0].question || '',
      category: firstMarket.category || 'Other',
      isMultiOutcome: markets.length > 2,
      marketCount: markets.length,
      volume: totalVolume,
      liquidity: totalLiquidity,
      endDate,
      markets: transformedMarkets,
      activeMarkets,
      image: firstMarket.image_url,
    };

    console.log(`[Event Detail API] Found event: ${title} (${markets.length} markets)`);

    return NextResponse.json({
      success: true,
      data: enrichedEvent,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Event Detail API] Error for slug ${slug}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
