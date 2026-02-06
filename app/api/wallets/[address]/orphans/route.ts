/**
 * Orphan Trades API - Transparency View
 *
 * GET /api/wallets/[address]/orphans
 *
 * Returns trades for a wallet that have empty/invalid condition_ids.
 * Provides transparency into data quality issues affecting the wallet.
 *
 * Uses pm_canonical_fills_v4 (the current production canonical fills table).
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Normalize wallet address
    const walletAddress = address.toLowerCase();

    // Get orphan trades for this wallet from pm_canonical_fills_v4
    const orphansResult = await clickhouse.query({
      query: `
        SELECT
          fill_id,
          tx_hash,
          wallet,
          condition_id,
          outcome_index,
          source,
          tokens_delta,
          usdc_delta,
          event_time,
          is_self_fill,
          is_maker,
          CASE
            WHEN condition_id IS NULL THEN 'missing'
            WHEN condition_id = '' THEN 'empty'
            WHEN length(condition_id) != 64 THEN 'invalid_length'
            ELSE 'unknown'
          END AS orphan_reason
        FROM pm_canonical_fills_v4
        WHERE wallet = {wallet:String}
          AND (
            condition_id IS NULL
            OR condition_id = ''
            OR length(condition_id) != 64
          )
        ORDER BY event_time DESC
        LIMIT 1000
      `,
      query_params: { wallet: walletAddress },
      format: 'JSONEachRow'
    });

    const orphans = await orphansResult.json<any>();

    // Get summary statistics
    const statsResult = await clickhouse.query({
      query: `
        SELECT
          count() AS total_orphans,
          sum(abs(usdc_delta)) AS total_orphan_volume,
          min(event_time) AS earliest_orphan,
          max(event_time) AS latest_orphan,
          countIf(condition_id IS NULL) AS missing_count,
          countIf(condition_id = '') AS empty_count,
          countIf(condition_id IS NOT NULL AND condition_id != '' AND length(condition_id) != 64) AS invalid_length_count
        FROM pm_canonical_fills_v4
        WHERE wallet = {wallet:String}
          AND (
            condition_id IS NULL
            OR condition_id = ''
            OR length(condition_id) != 64
          )
      `,
      query_params: { wallet: walletAddress },
      format: 'JSONEachRow'
    });

    const statsRows = await statsResult.json<any>();
    const stats = (Array.isArray(statsRows) ? statsRows : [])[0];

    // Get total trades for context
    const totalResult = await clickhouse.query({
      query: `
        SELECT count() AS total_trades
        FROM pm_canonical_fills_v4
        WHERE wallet = {wallet:String}
      `,
      query_params: { wallet: walletAddress },
      format: 'JSONEachRow'
    });

    const totalRows = await totalResult.json<any>();
    const totalTrades = (Array.isArray(totalRows) ? totalRows : [])[0]?.total_trades || 0;

    return NextResponse.json({
      wallet: walletAddress,
      orphans: orphans,
      stats: {
        ...stats,
        total_trades: totalTrades,
        orphan_pct: totalTrades > 0 ? (stats.total_orphans / totalTrades) * 100 : 0
      }
    });
  } catch (error) {
    console.error('Error fetching orphan trades:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orphan trades' },
      { status: 500 }
    );
  }
}
