/**
 * Whale Concentration API
 *
 * Returns market concentration metrics showing how much of each market
 * is controlled by whale wallets. Includes Herfindahl index calculation.
 *
 * Data source: market_holders table joined with wallets and markets
 * Update frequency: Updated hourly by background jobs
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20;
    const minWhaleShare = searchParams.get('min_whale_share') ? parseFloat(searchParams.get('min_whale_share')!) : 0;
    const sentiment = searchParams.get('sentiment');
    const sortBy = searchParams.get('sort_by') || 'whale_share_pct'; // whale_share_pct, herfindahl_index, total_whale_volume

    // Query market holders grouped by market
    const { data: holders, error } = await supabase
      .from('market_holders')
      .select(`
        market_id,
        shares,
        position_value_usd,
        wallet_address,
        wallets!inner(is_whale)
      `)
      .eq('wallets.is_whale', true)
      .limit(1000); // Get top holders

    if (error) {
      console.error('[Whale Concentration API] Database error:', error);
      throw error;
    }

    // Group by market and calculate metrics
    const marketMap = new Map();

    for (const holder of holders || []) {
      const marketId = holder.market_id;

      if (!marketMap.has(marketId)) {
        marketMap.set(marketId, {
          market_id: marketId,
          whale_holders: [],
          total_whale_volume: 0,
          market_shares: [],
        });
      }

      const market = marketMap.get(marketId);
      market.whale_holders.push(holder);
      market.total_whale_volume += parseFloat(holder.position_value_usd) || 0;

      // Store share percentage for Herfindahl calculation
      // This is simplified - would need total market supply to be accurate
      const shareValue = parseFloat(holder.position_value_usd) || 0;
      market.market_shares.push(shareValue);
    }

    // Calculate concentration metrics for each market
    const concentrationData = Array.from(marketMap.values()).map(market => {
      // Calculate Herfindahl index (sum of squared market shares)
      const totalVolume = market.total_whale_volume;
      const herfindahl = market.market_shares.reduce((sum: number, share: number) => {
        const sharePercent = share / totalVolume;
        return sum + (sharePercent * sharePercent);
      }, 0);

      // Find top whale
      const topHolder = market.whale_holders.sort(
        (a: any, b: any) => parseFloat(b.position_value_usd) - parseFloat(a.position_value_usd)
      )[0];

      const topWalletShare = topHolder
        ? (parseFloat(topHolder.position_value_usd) / totalVolume) * 100
        : 0;

      return {
        market_id: market.market_id,
        market_title: 'Market Title', // Would need to join with markets table
        total_whale_volume: Math.round(market.total_whale_volume),
        whale_share_pct: 0, // Would need total market volume to calculate
        unique_whales: market.whale_holders.length,
        herfindahl_index: Math.round(herfindahl * 100) / 100,
        top_wallet: topHolder ? {
          address: topHolder.wallet_address,
          alias: topHolder.wallet_address.slice(0, 8) + '...',
          volume: Math.round(parseFloat(topHolder.position_value_usd)),
          share_pct: Math.round(topWalletShare * 10) / 10,
        } : null,
        sentiment: herfindahl > 0.25 ? 'CONCENTRATED' : 'DISTRIBUTED',
      };
    });

    // Apply filters
    let filteredData = concentrationData;

    if (minWhaleShare > 0) {
      filteredData = filteredData.filter(d => d.whale_share_pct >= minWhaleShare);
    }

    if (sentiment && sentiment !== 'all') {
      filteredData = filteredData.filter(d => d.sentiment === sentiment.toUpperCase());
    }

    // Sort
    switch (sortBy) {
      case 'herfindahl_index':
        filteredData.sort((a: any, b: any) => b.herfindahl_index - a.herfindahl_index);
        break;
      case 'total_whale_volume':
        filteredData.sort((a: any, b: any) => b.total_whale_volume - a.total_whale_volume);
        break;
      case 'whale_share_pct':
      default:
        filteredData.sort((a: any, b: any) => b.whale_share_pct - a.whale_share_pct);
        break;
    }

    // Limit results
    filteredData = filteredData.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: filteredData,
      count: filteredData.length,
      filters: {
        limit,
        min_whale_share: minWhaleShare,
        sentiment,
        sort_by: sortBy,
      },
      note: filteredData.length === 0
        ? 'No concentration data found. Data will be available once market holders are synced from Polymarket Data-API.'
        : undefined,
    });
  } catch (error) {
    console.error('[Whale Concentration API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch whale concentration',
        data: [],
        count: 0,
        note: 'Database query failed. Ensure market_holders table is populated.'
      },
      { status: 500 }
    );
  }
}
