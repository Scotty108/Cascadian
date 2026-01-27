/**
 * Cron: Refresh Smart Money Wallets
 *
 * Recalculates top performing wallets from FIFO data and caches results.
 * Used for copy trading signals and leaderboard.
 *
 * Schedule: Daily at 8am UTC (0 8 * * *)
 * Timeout: 5 minutes
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

interface SmartMoneyWallet {
  wallet: string;
  trades: number;
  win_rate: number;
  total_pnl: number;
  volume: number;
  short_trades: number;
  short_pnl: number;
  short_pct: number;
  category: string;
}

async function getTopPerformers(client: any): Promise<SmartMoneyWallet[]> {
  const result = await client.query({
    query: `
      WITH deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(pnl_usd) as pnl_usd,
          any(cost_usd) as cost_usd,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3_deduped FINAL
        WHERE resolved_at >= now() - INTERVAL 30 DAY
        GROUP BY wallet, condition_id, outcome_index
      )
      SELECT
        wallet,
        count() as trades,
        round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate,
        round(sum(pnl_usd), 0) as total_pnl,
        round(sum(cost_usd), 0) as volume,
        countIf(is_short = 1) as short_trades,
        round(sumIf(pnl_usd, is_short = 1), 0) as short_pnl,
        round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct
      FROM deduped_fifo
      GROUP BY wallet
      HAVING trades >= 20
        AND total_pnl > 50000
        AND win_rate BETWEEN 45 AND 85
      ORDER BY total_pnl DESC
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return rows.map(r => ({
    ...r,
    category: r.short_pct < 5 ? 'DIRECTIONAL' : r.short_pct < 20 ? 'MIXED' : 'SPREAD_ARB'
  }));
}

async function getCopyWorthy(client: any): Promise<SmartMoneyWallet[]> {
  const result = await client.query({
    query: `
      WITH deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(pnl_usd) as pnl_usd,
          any(cost_usd) as cost_usd,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3_deduped FINAL
        WHERE resolved_at >= now() - INTERVAL 30 DAY
        GROUP BY wallet, condition_id, outcome_index
      )
      SELECT
        wallet,
        count() as trades,
        round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate,
        round(sum(pnl_usd), 0) as total_pnl,
        round(sum(cost_usd), 0) as volume,
        countIf(is_short = 1) as short_trades,
        round(sumIf(pnl_usd, is_short = 1), 0) as short_pnl,
        round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct
      FROM deduped_fifo
      GROUP BY wallet
      HAVING trades BETWEEN 20 AND 500
        AND short_pct < 15
        AND win_rate >= 55
        AND total_pnl > 10000
      ORDER BY total_pnl DESC
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return rows.map(r => ({ ...r, category: 'COPY_WORTHY' }));
}

async function getShortSpecialists(client: any): Promise<SmartMoneyWallet[]> {
  const result = await client.query({
    query: `
      WITH deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(pnl_usd) as pnl_usd,
          any(cost_usd) as cost_usd,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3_deduped FINAL
        WHERE resolved_at >= now() - INTERVAL 30 DAY
        GROUP BY wallet, condition_id, outcome_index
      )
      SELECT
        wallet,
        countIf(is_short = 1) as trades,
        round(countIf(is_short = 1 AND pnl_usd > 0) * 100.0 / countIf(is_short = 1), 1) as win_rate,
        round(sumIf(pnl_usd, is_short = 1), 0) as total_pnl,
        round(sumIf(cost_usd, is_short = 1), 0) as volume,
        countIf(is_short = 1) as short_trades,
        round(sumIf(pnl_usd, is_short = 1), 0) as short_pnl,
        100.0 as short_pct
      FROM deduped_fifo
      GROUP BY wallet
      HAVING short_trades >= 20
        AND win_rate >= 50
        AND total_pnl > 10000
      ORDER BY total_pnl DESC
      LIMIT 30
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return rows.map(r => ({ ...r, category: 'SHORT_SPECIALIST' }));
}

async function upsertSmartMoneyCache(client: any, wallets: SmartMoneyWallet[]): Promise<void> {
  if (wallets.length === 0) return;

  // First, clear old cache
  await client.command({
    query: `ALTER TABLE pm_smart_money_cache DELETE WHERE 1=1`,
    clickhouse_settings: { mutations_sync: 1 },
  }).catch(() => {
    // Table might not exist, create it
  });

  // Check if table exists, create if not
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_smart_money_cache (
        wallet LowCardinality(String),
        trades UInt32,
        win_rate Float32,
        total_pnl Float64,
        volume Float64,
        short_trades UInt32,
        short_pnl Float64,
        short_pct Float32,
        category LowCardinality(String),
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (wallet, category)
    `,
  }).catch(() => {});

  // Insert new data
  await client.insert({
    table: 'pm_smart_money_cache',
    values: wallets.map(w => ({
      wallet: w.wallet,
      trades: w.trades,
      win_rate: w.win_rate,
      total_pnl: w.total_pnl,
      volume: w.volume,
      short_trades: w.short_trades,
      short_pnl: w.short_pnl,
      short_pct: w.short_pct,
      category: w.category,
    })),
    format: 'JSONEachRow',
  });
}

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'refresh-smart-money');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const client = getClickHouseClient();

    // Get all categories
    const [topPerformers, copyWorthy, shortSpecialists] = await Promise.all([
      getTopPerformers(client),
      getCopyWorthy(client),
      getShortSpecialists(client),
    ]);

    // Combine and dedupe by wallet (keep highest PnL category)
    const walletMap = new Map<string, SmartMoneyWallet>();

    for (const wallet of [...topPerformers, ...copyWorthy, ...shortSpecialists]) {
      const existing = walletMap.get(wallet.wallet);
      if (!existing || wallet.total_pnl > existing.total_pnl) {
        walletMap.set(wallet.wallet, wallet);
      }
    }

    const allWallets = Array.from(walletMap.values());

    // Cache results
    await upsertSmartMoneyCache(client, allWallets);

    const duration = (Date.now() - startTime) / 1000;

    return NextResponse.json({
      success: true,
      topPerformers: topPerformers.length,
      copyWorthy: copyWorthy.length,
      shortSpecialists: shortSpecialists.length,
      totalCached: allWallets.length,
      duration: `${duration.toFixed(1)}s`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Smart money refresh failed:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
