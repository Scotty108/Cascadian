/**
 * Targeted refresh of export-eligible wallets
 *
 * Recomputes PnL with taker_ratio for wallets that currently pass export criteria.
 * This is faster than a full batch run since we only process ~2000 wallets.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '../../lib/pnl/loadResolutionsStrict';

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

async function getExportCandidates(client: any): Promise<string[]> {
  // Get wallets that pass export criteria by OLD cache values
  const result = await client.query({
    query: `
      SELECT wallet
      FROM pm_wallet_engine_pnl_cache FINAL
      WHERE external_sells_ratio <= 0.10  -- Looser to catch borderline cases
        AND open_exposure_ratio <= 0.35
        AND trade_count >= 50
        AND realized_pnl > 0
      ORDER BY realized_pnl DESC
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
        SELECT
          lower(trader_wallet) as wallet,
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) IN (${walletList})
          AND is_deleted = 0
          AND role = 'maker'
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
    const trades = tradesByWallet.get(row.wallet.toLowerCase());
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
    countsByWallet.set(row.wallet.toLowerCase(), {
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

async function main() {
  const client = getClickHouseClient();

  console.log('=== TARGETED REFRESH: EXPORT CANDIDATES ===\n');

  // Load resolutions
  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  // Get export candidates
  console.log('Getting export candidates from cache...');
  const candidates = await getExportCandidates(client);
  console.log(`Found ${candidates.length.toLocaleString()} candidates to refresh\n`);

  const allResults: WalletPnlResult[] = [];
  let processed = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    const tradesByWallet = await loadWalletTrades(client, batch);
    const takerCounts = await loadTakerCounts(client, batch);

    for (const wallet of batch) {
      const trades = tradesByWallet.get(wallet) || [];
      const counts = takerCounts.get(wallet) || { makerCount: 0, takerCount: 0 };
      const totalTrades = counts.makerCount + counts.takerCount;
      const takerRatio = totalTrades > 0 ? counts.takerCount / totalTrades : 0;
      const result = computeWalletPnl(wallet, trades, resolutions, takerRatio);
      allResults.push(result);
      processed++;
    }

    // Insert batch
    await insertResults(client, allResults.slice(-batch.length));

    const pct = ((processed / candidates.length) * 100).toFixed(1);
    process.stdout.write(`\r${processed}/${candidates.length} (${pct}%)     `);
  }

  console.log('\n\nDone!\n');

  // Show results with new filters
  const strictFiltered = allResults.filter((r) =>
    r.externalSellsRatio <= 0.05 &&
    r.openExposureRatio <= 0.25 &&
    r.takerRatio <= 0.15 &&
    r.tradeCount >= 50 &&
    r.realizedPnl > 0
  ).sort((a, b) => b.realizedPnl - a.realizedPnl);

  console.log('=== STRICT EXPORT FILTER (with taker_ratio) ===');
  console.log(`Wallets passing: ${strictFiltered.length}\n`);

  console.log('Top 30 by realized_pnl:');
  for (const r of strictFiltered.slice(0, 30)) {
    const realized = `$${(r.realizedPnl / 1000).toFixed(1)}k`;
    const ext = `${(r.externalSellsRatio * 100).toFixed(1)}%`;
    const exp = `${(r.openExposureRatio * 100).toFixed(1)}%`;
    const tkr = `${(r.takerRatio * 100).toFixed(1)}%`;
    console.log(`  ${r.wallet.slice(0, 16)}.. | R=${realized.padStart(9)} | ext=${ext.padStart(5)} | exp=${exp.padStart(5)} | tkr=${tkr.padStart(5)}`);
  }

  // Show who got filtered out by taker_ratio
  const filteredByTaker = allResults.filter((r) =>
    r.externalSellsRatio <= 0.05 &&
    r.openExposureRatio <= 0.25 &&
    r.takerRatio > 0.15 &&
    r.tradeCount >= 50 &&
    r.realizedPnl > 0
  );

  if (filteredByTaker.length > 0) {
    console.log(`\n\nFiltered OUT by taker_ratio > 15%: ${filteredByTaker.length}`);
    for (const r of filteredByTaker.slice(0, 10)) {
      console.log(`  ${r.wallet.slice(0, 16)}.. | R=$${(r.realizedPnl/1000).toFixed(1)}k | tkr=${(r.takerRatio*100).toFixed(1)}%`);
    }
  }
}

main().catch(console.error);
