/**
 * Streaming Engine PnL Computation
 *
 * Processes wallets in small batches with streaming to avoid memory issues.
 * Uses the stats table to get wallet list, then processes each batch.
 *
 * Usage:
 *   npx tsx scripts/pnl/stream-compute-engine-pnl.ts [--limit=N] [--offset=N]
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

const BATCH_SIZE = 200; // Wallets per batch (sweet spot for memory/speed)

interface WalletPnlResult {
  wallet: string;
  enginePnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  positionCount: number;
  externalSells: number;
  profitFactor: number;
  externalSellsRatio: number;
  openExposureRatio: number;
  takerRatio: number;
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
  let unresolvedPositionCost = 0;

  for (const [tokenId, pos] of positions) {
    realizedPnl += pos.realizedPnl;
    const payout = resolutions.get(tokenId);

    if (pos.amount > 0) {
      if (payout !== undefined) {
        unrealizedPnl += pos.amount * (payout - pos.avgPrice);
      } else {
        unresolvedPositionCost += pos.amount * pos.avgPrice;
      }
    }

    const positionPnl = pos.realizedPnl + (payout !== undefined && pos.amount > 0 ? pos.amount * (payout - pos.avgPrice) : 0);
    if (positionPnl > 0) winningPnl += positionPnl;
    else if (positionPnl < 0) losingPnl += Math.abs(positionPnl);
  }

  const enginePnl = realizedPnl + unrealizedPnl;
  return {
    wallet,
    enginePnl,
    realizedPnl,
    unrealizedPnl,
    tradeCount: trades.length,
    positionCount: positions.size,
    externalSells,
    profitFactor: losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? 999 : 1,
    externalSellsRatio: totalSells > 0 ? externalSells / totalSells : 0,
    openExposureRatio: unresolvedPositionCost / Math.max(Math.abs(enginePnl), 1),
    takerRatio,
  };
}

async function loadWalletTrades(client: any, wallets: string[]): Promise<Map<string, any[]>> {
  const walletList = wallets.map((w) => `'${w}'`).join(',');
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          lower(trader_wallet) as wallet, event_id,
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

async function insertResults(client: any, results: WalletPnlResult[]): Promise<void> {
  if (results.length === 0) return;
  await client.insert({
    table: 'pm_wallet_engine_pnl_cache',
    values: results.map((r) => ({
      wallet: r.wallet,
      engine_pnl: r.enginePnl,
      realized_pnl: r.realizedPnl,
      unrealized_pnl: r.unrealizedPnl,
      trade_count: r.tradeCount,
      position_count: r.positionCount,
      external_sells: r.externalSells,
      profit_factor: r.profitFactor,
      external_sells_ratio: r.externalSellsRatio,
      open_exposure_ratio: r.openExposureRatio,
      taker_ratio: r.takerRatio,
    })),
    format: 'JSONEachRow',
  });
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const offsetArg = args.find((a) => a.startsWith('--offset='));

  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
  const offset = offsetArg ? parseInt(offsetArg.split('=')[1]) : 0;

  const client = getClickHouseClient();

  console.log('=== STREAMING ENGINE PNL COMPUTATION ===\n');

  // Load resolutions once
  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  // Get active wallets from stats table (already filtered)
  console.log('Getting active wallets from stats table...');
  const walletResult = await client.query({
    query: `
      SELECT wallet, taker_ratio
      FROM pm_wallet_trade_stats FINAL
      WHERE last_trade_time >= now() - INTERVAL 30 DAY
        AND maker_count >= 20
        AND maker_count <= 50000
      ORDER BY wallet
      ${limit !== Infinity ? `LIMIT ${limit} OFFSET ${offset}` : ''}
    `,
    format: 'JSONEachRow',
  });
  const walletRows = (await walletResult.json()) as any[];
  const walletTakerRatios = new Map<string, number>();
  for (const row of walletRows) {
    walletTakerRatios.set(row.wallet, Number(row.taker_ratio));
  }
  const wallets = Array.from(walletTakerRatios.keys());

  console.log(`Processing ${wallets.length.toLocaleString()} wallets\n`);

  const startTime = Date.now();
  let processed = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    try {
      const tradesByWallet = await loadWalletTrades(client, batch);
      const results: WalletPnlResult[] = [];

      for (const wallet of batch) {
        const trades = tradesByWallet.get(wallet) || [];
        const takerRatio = walletTakerRatios.get(wallet) || 0;
        results.push(computeWalletPnl(wallet, trades, resolutions, takerRatio));
        processed++;
      }

      await insertResults(client, results);

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const pct = ((processed / wallets.length) * 100).toFixed(1);
      const eta = (wallets.length - processed) / rate;
      process.stdout.write(`\r${processed}/${wallets.length} (${pct}%) | ${rate.toFixed(0)}/s | ETA ${Math.round(eta)}s     `);

    } catch (e: any) {
      console.error(`\nBatch error at ${i}: ${e.message}`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n=== COMPLETE ===`);
  console.log(`Processed: ${processed.toLocaleString()} wallets in ${(elapsed / 60).toFixed(1)} min`);
  console.log(`Rate: ${(processed / elapsed).toFixed(0)} wallets/s`);
}

main().catch(console.error);
