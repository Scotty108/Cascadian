/**
 * Scan-based Engine PnL Computation
 *
 * Sequential scan approach - ONE query per wallet range, not per-wallet queries.
 * This scales to 100k+ wallets efficiently.
 *
 * Usage:
 *   # Single range (full scan):
 *   npx tsx scripts/pnl/scan-compute-engine-pnl.ts
 *
 *   # Specific range (for parallel workers):
 *   npx tsx scripts/pnl/scan-compute-engine-pnl.ts --rangeStart=0x0 --rangeEnd=0x2
 *
 *   # With whale filter:
 *   npx tsx scripts/pnl/scan-compute-engine-pnl.ts --maxTrades=50000
 *
 * Parallel execution (run in separate terminals):
 *   npx tsx scripts/pnl/scan-compute-engine-pnl.ts --rangeStart=0x0 --rangeEnd=0x4 &
 *   npx tsx scripts/pnl/scan-compute-engine-pnl.ts --rangeStart=0x4 --rangeEnd=0x8 &
 *   npx tsx scripts/pnl/scan-compute-engine-pnl.ts --rangeStart=0x8 --rangeEnd=0xc &
 *   npx tsx scripts/pnl/scan-compute-engine-pnl.ts --rangeStart=0xc --rangeEnd=0xg &
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

// Accumulator for streaming computation
class WalletAccumulator {
  wallet: string;
  positions: Map<string, Position> = new Map();
  externalSells = 0;
  totalSells = 0;
  tradeCount = 0;

  constructor(wallet: string) {
    this.wallet = wallet;
  }

  addTrade(tokenId: string, side: string, tokenAmount: number, usdcAmount: number): void {
    let pos = this.positions.get(tokenId) || emptyPosition(this.wallet, tokenId);
    const price = tokenAmount > 0 ? usdcAmount / tokenAmount : 0;

    if (side === 'buy') {
      pos = updateWithBuy(pos, tokenAmount, price);
    } else {
      this.totalSells += usdcAmount;
      const { position: newPos, result } = updateWithSell(pos, tokenAmount, price);
      pos = newPos;
      this.externalSells += result.externalSell;
    }

    this.positions.set(tokenId, pos);
    this.tradeCount++;
  }

  finalize(resolutions: Map<string, number>, takerRatio: number): WalletPnlResult {
    let realizedPnl = 0;
    let unrealizedPnl = 0;
    let winningPnl = 0;
    let losingPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let unresolvedPositionCost = 0;

    for (const [tokenId, pos] of this.positions) {
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

      if (positionPnl > 0) {
        winningPnl += positionPnl;
        winCount++;
      } else if (positionPnl < 0) {
        losingPnl += Math.abs(positionPnl);
        lossCount++;
      }
    }

    const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? 999 : 1;
    const externalSellsRatio = this.totalSells > 0 ? this.externalSells / this.totalSells : 0;
    const enginePnl = realizedPnl + unrealizedPnl;
    const openExposureRatio = unresolvedPositionCost / Math.max(Math.abs(enginePnl), 1);

    return {
      wallet: this.wallet,
      enginePnl,
      realizedPnl,
      unrealizedPnl,
      tradeCount: this.tradeCount,
      positionCount: this.positions.size,
      externalSells: this.externalSells,
      winningPnl,
      losingPnl,
      profitFactor,
      winCount,
      lossCount,
      totalSells: this.totalSells,
      externalSellsRatio,
      unresolvedPositionCost,
      openExposureRatio,
      takerRatio,
    };
  }
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

async function loadTakerRatios(client: any, rangeStart: string, rangeEnd: string): Promise<Map<string, number>> {
  const result = await client.query({
    query: `
      SELECT wallet, taker_ratio
      FROM pm_wallet_trade_stats FINAL
      WHERE wallet >= '${rangeStart}' AND wallet < '${rangeEnd}'
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const ratios = new Map<string, number>();
  for (const row of rows) {
    ratios.set(row.wallet, Number(row.taker_ratio));
  }
  return ratios;
}

async function getWalletsInRange(
  client: any,
  rangeStart: string,
  rangeEnd: string,
  maxTrades: number
): Promise<Set<string>> {
  // Get wallets that are active and under the whale threshold
  const result = await client.query({
    query: `
      SELECT wallet
      FROM pm_wallet_trade_stats FINAL
      WHERE wallet >= '${rangeStart}' AND wallet < '${rangeEnd}'
        AND maker_count <= ${maxTrades}
        AND last_trade_time >= now() - INTERVAL 30 DAY
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return new Set(rows.map((r) => r.wallet));
}

async function main() {
  const args = process.argv.slice(2);

  const rangeStartArg = args.find((a) => a.startsWith('--rangeStart='));
  const rangeEndArg = args.find((a) => a.startsWith('--rangeEnd='));
  const maxTradesArg = args.find((a) => a.startsWith('--maxTrades='));

  const rangeStart = rangeStartArg ? rangeStartArg.split('=')[1] : '0x0';
  const rangeEnd = rangeEndArg ? rangeEndArg.split('=')[1] : '0xg'; // 'g' > 'f' so captures all hex
  const maxTrades = maxTradesArg ? parseInt(maxTradesArg.split('=')[1]) : 50000;

  const client = getClickHouseClient();

  console.log(`=== SCAN-BASED ENGINE PNL [${rangeStart} - ${rangeEnd}] ===\n`);
  console.log(`Max trades per wallet: ${maxTrades.toLocaleString()}`);

  // Load resolutions
  console.log('\nLoading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions`);

  // Load taker ratios from stats table
  console.log('Loading taker ratios from stats table...');
  const takerRatios = await loadTakerRatios(client, rangeStart, rangeEnd);
  console.log(`Loaded ${takerRatios.size.toLocaleString()} taker ratios`);

  // Get valid wallets (active, under whale threshold)
  console.log('Getting valid wallets in range...');
  const validWallets = await getWalletsInRange(client, rangeStart, rangeEnd, maxTrades);
  console.log(`Found ${validWallets.size.toLocaleString()} valid wallets\n`);

  if (validWallets.size === 0) {
    console.log('No wallets to process in this range.');
    return;
  }

  // Stream trades in range (sorted by wallet, trade_time)
  console.log('Streaming trades (sequential scan)...');
  const startTime = Date.now();

  const tradeStream = await client.query({
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
        WHERE lower(trader_wallet) >= '${rangeStart}'
          AND lower(trader_wallet) < '${rangeEnd}'
          AND is_deleted = 0
          AND role = 'maker'
        GROUP BY wallet, event_id
      )
      SELECT * FROM deduped
      ORDER BY wallet, trade_time, event_id
    `,
    format: 'JSONEachRow',
  });

  const allTrades = (await tradeStream.json()) as any[];
  console.log(`Loaded ${allTrades.length.toLocaleString()} trades\n`);

  // Process trades sequentially
  let currentAccumulator: WalletAccumulator | null = null;
  const resultBuffer: WalletPnlResult[] = [];
  let processedWallets = 0;
  let skippedWallets = 0;
  const flushThreshold = 500;

  for (const trade of allTrades) {
    const wallet = trade.wallet;

    // Skip wallets not in valid set (whales, inactive)
    if (!validWallets.has(wallet)) {
      continue;
    }

    // New wallet - finalize previous and start new accumulator
    if (!currentAccumulator || currentAccumulator.wallet !== wallet) {
      if (currentAccumulator) {
        const takerRatio = takerRatios.get(currentAccumulator.wallet) || 0;
        const result = currentAccumulator.finalize(resolutions, takerRatio);
        resultBuffer.push(result);
        processedWallets++;

        // Flush buffer periodically
        if (resultBuffer.length >= flushThreshold) {
          await insertResults(client, resultBuffer);
          resultBuffer.length = 0;

          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processedWallets / elapsed;
          const pct = ((processedWallets / validWallets.size) * 100).toFixed(1);
          process.stdout.write(`\r${processedWallets}/${validWallets.size} (${pct}%) | ${rate.toFixed(0)}/s     `);
        }
      }

      currentAccumulator = new WalletAccumulator(wallet);
    }

    // Add trade to accumulator
    currentAccumulator.addTrade(
      trade.token_id,
      trade.side,
      Number(trade.token_amount),
      Number(trade.usdc_amount)
    );
  }

  // Finalize last wallet
  if (currentAccumulator) {
    const takerRatio = takerRatios.get(currentAccumulator.wallet) || 0;
    const result = currentAccumulator.finalize(resolutions, takerRatio);
    resultBuffer.push(result);
    processedWallets++;
  }

  // Flush remaining
  if (resultBuffer.length > 0) {
    await insertResults(client, resultBuffer);
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n=== COMPLETE ===`);
  console.log(`Processed: ${processedWallets.toLocaleString()} wallets`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
  console.log(`Rate: ${(processedWallets / elapsed).toFixed(0)} wallets/s`);
}

main().catch((e) => {
  console.error('\nScan failed:', e);
  process.exit(1);
});
