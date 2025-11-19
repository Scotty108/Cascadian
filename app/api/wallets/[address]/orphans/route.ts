/**
 * Orphan Trades API - Transparency View
 *
 * GET /api/wallets/[address]/orphans
 *
 * Returns trades for a wallet that have empty/invalid condition_ids.
 * Provides transparency into data quality issues affecting the wallet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { getOrphanOnlyFilter } from '@/lib/clickhouse/orphan-filter';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Normalize wallet address
    const walletAddress = address.toLowerCase();

    // Get orphan trades for this wallet
    const orphansResult = await clickhouse.query({
      query: `
        SELECT
          trade_id,
          transaction_hash,
          wallet_address,
          wallet_canonical,
          condition_id_norm_v3,
          outcome_index_v3,
          trade_direction,
          shares,
          price,
          usd_value,
          fee,
          timestamp,
          created_at,
          source,
          CASE
            WHEN condition_id_norm_v3 IS NULL THEN 'missing'
            WHEN condition_id_norm_v3 = '' THEN 'empty'
            WHEN length(condition_id_norm_v3) != 64 THEN 'invalid_length'
            ELSE 'unknown'
          END AS orphan_reason
        FROM pm_trades_canonical_v3
        WHERE wallet_canonical = {wallet:String}
          AND ${getOrphanOnlyFilter('condition_id_norm_v3')}
        ORDER BY timestamp DESC
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
          sum(usd_value) AS total_orphan_volume,
          min(timestamp) AS earliest_orphan,
          max(timestamp) AS latest_orphan,
          countIf(condition_id_norm_v3 IS NULL) AS missing_count,
          countIf(condition_id_norm_v3 = '') AS empty_count,
          countIf(condition_id_norm_v3 IS NOT NULL AND condition_id_norm_v3 != '' AND length(condition_id_norm_v3) != 64) AS invalid_length_count
        FROM pm_trades_canonical_v3
        WHERE wallet_canonical = {wallet:String}
          AND ${getOrphanOnlyFilter('condition_id_norm_v3')}
      `,
      query_params: { wallet: walletAddress },
      format: 'JSONEachRow'
    });

    const statsRows = await statsResult.json<any>();
    const stats = (statsRows || [])[0];

    // Get total trades for context
    const totalResult = await clickhouse.query({
      query: `
        SELECT count() AS total_trades
        FROM pm_trades_canonical_v3
        WHERE wallet_canonical = {wallet:String}
      `,
      query_params: { wallet: walletAddress },
      format: 'JSONEachRow'
    });

    const totalRows = await totalResult.json<any>();
    const totalTrades = (totalRows || [])[0]?.total_trades || 0;

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
