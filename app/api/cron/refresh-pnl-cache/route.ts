/**
 * Cron: Refresh PnL Cache
 *
 * Runs the batch computation for export candidates, updating pm_wallet_engine_pnl_cache
 * with proper taker_ratio and exclusion metrics.
 *
 * Schedule: Daily at 3am UTC (0 3 * * *)
 * Timeout: 10 minutes (max for Vercel Pro)
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';
import { logCronExecution } from '@/lib/alerts/cron-tracker';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '@/lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '@/lib/pnl/loadResolutionsStrict';

export const maxDuration = 600; // 10 minutes
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;

interface WalletPnlResult {
  wallet: string;
  enginePnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  positionCount: number;
  externalSells: number;
  winningPnl: number;
  losingPnl: number;
  profitFactor: number;
  winCount: number;
  lossCount: number;
  totalSells: number;
  externalSellsRatio: number;
  unresolvedPositionCost: number;
  openExposureRatio: number;
  takerRatio: number;
}

async function getActiveWallets(client: any, maxTrades = 50000): Promise<string[]> {
  const result = await client.query({
    query: `
      SELECT lower(trader_wallet) as wallet, count() as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND role = 'maker'
      GROUP BY wallet
      HAVING cnt > 20 AND cnt <= ${maxTrades}
        AND countIf(trade_time >= now() - INTERVAL 30 DAY) > 0
      ORDER BY cnt DESC
      LIMIT 5000
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return rows.map((r) => r.wallet);
}

async function loadWalletTrades(client: any, wallets: string[]): Promise<Map<string, any[]>> {
  const walletList = wallets.map((w) => `'${w}'`).join(',');
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT lower(trader_wallet) as wallet, event_id,
          any(token_id) as token_id, any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) IN (${walletList}) AND is_deleted = 0 AND role = 'maker'
        GROUP BY wallet, event_id
      )
      SELECT * FROM deduped ORDER BY wallet, trade_time
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const tradesByWallet = new Map<string, any[]>();
  for (const w of wallets) tradesByWallet.set(w, []);
  for (const row of rows) {
    const trades = tradesByWallet.get(row.wallet);
    if (trades) trades.push(row);
  }
  return tradesByWallet;
}

async function loadTakerCounts(client: any, wallets: string[]): Promise<Map<string, { makerCount: number; takerCount: number }>> {
  const walletList = wallets.map((w) => `'${w}'`).join(',');
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT lower(trader_wallet) as wallet, event_id, any(role) as role
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) IN (${walletList}) AND is_deleted = 0
        GROUP BY wallet, event_id
      )
      SELECT wallet, countIf(role = 'maker') as maker_count, countIf(role = 'taker') as taker_count
      FROM deduped GROUP BY wallet
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const countsByWallet = new Map<string, { makerCount: number; takerCount: number }>();
  for (const row of rows) {
    countsByWallet.set(row.wallet, {
      makerCount: Number(row.maker_count),
      takerCount: Number(row.taker_count),
    });
  }
  return countsByWallet;
}

function computeWalletPnl(
  wallet: string,
  trades: any[],
  resolutions: Map<string, number>,
  takerRatio: number
): WalletPnlResult {
  const positions = new Map<string, Position>();
  let externalSells = 0;
  let totalSells = 0;

  for (const t of trades) {
    let pos = positions.get(t.token_id) || emptyPosition(wallet, t.token_id);
    const price = Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;

    if (t.side === 'buy') {
      pos = updateWithBuy(pos, Number(t.token_amount), price);
    } else {
      totalSells += Number(t.usdc_amount);
      const { position: newPos, result } = updateWithSell(pos, Number(t.token_amount), price);
      pos = newPos;
      externalSells += result.externalSell;
    }
    positions.set(t.token_id, pos);
  }

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let winningPnl = 0;
  let losingPnl = 0;
  let winCount = 0;
  let lossCount = 0;
  let unresolvedPositionCost = 0;

  for (const [tokenId, pos] of positions) {
    realizedPnl += pos.realizedPnl;
    let positionPnl = pos.realizedPnl;
    const payout = resolutions.get(tokenId);

    if (pos.amount > 0) {
      if (payout !== undefined) {
        const unrealizedForPos = pos.amount * (payout - pos.avgPrice);
        unrealizedPnl += unrealizedForPos;
        positionPnl += unrealizedForPos;
      } else {
        unresolvedPositionCost += pos.amount * pos.avgPrice;
      }
    }

    if (positionPnl > 0) { winningPnl += positionPnl; winCount++; }
    else if (positionPnl < 0) { losingPnl += Math.abs(positionPnl); lossCount++; }
  }

  const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : (winningPnl > 0 ? 999 : 1);
  const externalSellsRatio = totalSells > 0 ? externalSells / totalSells : 0;
  const enginePnl = realizedPnl + unrealizedPnl;
  const openExposureRatio = unresolvedPositionCost / Math.max(Math.abs(enginePnl), 1);

  return {
    wallet, enginePnl, realizedPnl, unrealizedPnl,
    tradeCount: trades.length, positionCount: positions.size,
    externalSells, winningPnl, losingPnl, profitFactor,
    winCount, lossCount, totalSells, externalSellsRatio,
    unresolvedPositionCost, openExposureRatio, takerRatio,
  };
}

async function insertResults(client: any, results: WalletPnlResult[]): Promise<void> {
  if (results.length === 0) return;

  const values = results.map((r) => ({
    wallet: r.wallet,
    engine_pnl: r.enginePnl,
    realized_pnl: r.realizedPnl,
    unrealized_pnl: r.unrealizedPnl,
    trade_count: r.tradeCount,
    position_count: r.positionCount,
    external_sells: r.externalSells,
    winning_pnl: r.winningPnl,
    losing_pnl: r.losingPnl,
    profit_factor: r.profitFactor,
    win_count: r.winCount,
    loss_count: r.lossCount,
    total_sells: r.totalSells,
    external_sells_ratio: r.externalSellsRatio,
    unresolved_position_cost: r.unresolvedPositionCost,
    open_exposure_ratio: r.openExposureRatio,
    taker_ratio: r.takerRatio,
  }));

  await client.insert({
    table: 'pm_wallet_engine_pnl_cache',
    values,
    format: 'JSONEachRow',
  });
}

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'refresh-pnl-cache');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const client = getClickHouseClient();

    // Load resolutions
    const { resolutions } = await loadResolutionsStrict();

    // Get active wallets (skip whales with >50k trades)
    const wallets = await getActiveWallets(client, 50000);

    let processed = 0;
    let profitable = 0;

    // Process in batches
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
      const batch = wallets.slice(i, i + BATCH_SIZE);

      const tradesByWallet = await loadWalletTrades(client, batch);
      const takerCounts = await loadTakerCounts(client, batch);

      const results: WalletPnlResult[] = [];

      for (const wallet of batch) {
        const trades = tradesByWallet.get(wallet) || [];
        const counts = takerCounts.get(wallet) || { makerCount: 0, takerCount: 0 };
        const totalTrades = counts.makerCount + counts.takerCount;
        const takerRatio = totalTrades > 0 ? counts.takerCount / totalTrades : 0;
        const result = computeWalletPnl(wallet, trades, resolutions, takerRatio);
        results.push(result);
        processed++;
        if (result.enginePnl > 0) profitable++;
      }

      await insertResults(client, results);
    }

    const duration = (Date.now() - startTime) / 1000;

    await logCronExecution({
      cron_name: 'refresh-pnl-cache',
      status: 'success',
      duration_ms: Date.now() - startTime,
      details: { processed, profitable },
    });

    return NextResponse.json({
      success: true,
      processed,
      profitable,
      duration: `${duration.toFixed(1)}s`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('PnL cache refresh failed:', error);

    await logCronExecution({
      cron_name: 'refresh-pnl-cache',
      status: 'failure',
      duration_ms: Date.now() - startTime,
      error_message: String(error),
    });

    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
