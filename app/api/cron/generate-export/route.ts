/**
 * Cron: Generate High-Confidence Winners Export
 *
 * Produces a CSV of wallets suitable for copy-trading and stores it.
 *
 * Schedule: Daily at 4am UTC (0 4 * * *)
 * Runs after refresh-pnl-cache completes
 */
import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Export criteria - keep in sync with docs/ops/pnl_jobs.md
const EXPORT_QUERY = `
SELECT
  wallet,
  realized_pnl,
  engine_pnl,
  trade_count,
  profit_factor,
  external_sells_ratio,
  open_exposure_ratio,
  taker_ratio,
  toString(computed_at) as computed_at
FROM pm_wallet_engine_pnl_cache FINAL
WHERE external_sells_ratio <= 0.05
  AND open_exposure_ratio <= 0.25
  AND taker_ratio <= 0.15
  AND trade_count >= 50
  AND realized_pnl > 0
ORDER BY realized_pnl DESC
`;

interface ExportRow {
  wallet: string;
  realized_pnl: number;
  engine_pnl: number;
  trade_count: number;
  profit_factor: number;
  external_sells_ratio: number;
  open_exposure_ratio: number;
  taker_ratio: number;
  computed_at: string;
}

export async function GET() {
  const startTime = Date.now();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  try {
    const client = getClickHouseClient();

    // Run query
    const result = await client.query({
      query: EXPORT_QUERY,
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as ExportRow[];

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No wallets to export',
        count: 0,
      });
    }

    // Generate CSV
    const headers = [
      'wallet',
      'realized_pnl',
      'engine_pnl',
      'trade_count',
      'profit_factor',
      'external_sells_ratio',
      'open_exposure_ratio',
      'taker_ratio',
      'computed_at',
    ];

    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push([
        row.wallet,
        row.realized_pnl.toFixed(2),
        row.engine_pnl.toFixed(2),
        row.trade_count,
        row.profit_factor.toFixed(4),
        row.external_sells_ratio.toFixed(6),
        row.open_exposure_ratio.toFixed(6),
        row.taker_ratio.toFixed(6),
        row.computed_at,
      ].join(','));
    }

    // In production, this would upload to S3/GCS/Supabase Storage
    // For now, save locally (won't persist on Vercel serverless)
    const exportsDir = path.join(process.cwd(), 'exports');
    if (fs.existsSync(exportsDir)) {
      const csvPath = path.join(exportsDir, `high_confidence_realized_winners_${date}.csv`);
      fs.writeFileSync(csvPath, csvLines.join('\n'));
    }

    // Summary stats
    const totalRealizedPnl = rows.reduce((sum, r) => sum + r.realized_pnl, 0);

    const duration = (Date.now() - startTime) / 1000;

    return NextResponse.json({
      success: true,
      count: rows.length,
      totalRealizedPnl: totalRealizedPnl.toFixed(0),
      date,
      duration: `${duration.toFixed(1)}s`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Export generation failed:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
