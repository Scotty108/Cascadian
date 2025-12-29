/**
 * Batch Compute Engine PnL for Active Wallets
 *
 * Computes real cost-basis PnL for all wallets matching copy-trading criteria.
 * Results are stored in a cache table for fast querying.
 *
 * Filters:
 * - >20 maker trades
 * - At least 1 trade in last 30 days
 *
 * Run with: npx tsx scripts/pnl/batch-compute-engine-pnl.ts [--sample=1000] [--offset=0] [--maxTrades=50000]
 *
 * Export Criteria (High-Confidence Realized Winners):
 * - external_sells_ratio <= 0.05 (minimal external token activity)
 * - open_exposure_ratio <= 0.25 (mostly resolved positions)
 * - taker_ratio <= 0.15 (primarily maker trades - replicable)
 * - trade_count >= 50 (sufficient history)
 * - realized_pnl > 0 (actually profitable on closed positions)
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

const BATCH_SIZE = 50; // Wallets per batch

interface WalletPnlResult {
  wallet: string;
  enginePnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  positionCount: number;
  externalSells: number;
  // Profit Factor metrics (sum of wins / sum of losses)
  winningPnl: number;  // Sum of positive position PnL
  losingPnl: number;   // Sum of negative position PnL (absolute value)
  profitFactor: number; // winningPnl / losingPnl (999 if no losses)
  winCount: number;    // Positions with positive PnL
  lossCount: number;   // Positions with negative PnL
  // Exclusion ratio fields (for filtering copy-trading candidates)
  totalSells: number;           // Total USDC from all sells
  externalSellsRatio: number;   // external_sells / total_sells (0-1)
  unresolvedPositionCost: number; // Cost basis of positions without resolution
  openExposureRatio: number;    // unresolved_cost / max(abs(engine_pnl), 1)
  takerRatio: number;           // taker_trades / total_trades (0-1) - detects non-replicable PnL
}

interface WalletInfo {
  wallet: string;
  tradeCount: number;
}

async function getActiveWallets(
  client: any,
  limit?: number,
  offset = 0,
  maxTrades?: number
): Promise<WalletInfo[]> {
  const limitClause = limit ? `LIMIT ${limit} OFFSET ${offset}` : '';
  const maxTradesFilter = maxTrades ? `AND cnt <= ${maxTrades}` : '';

  const result = await client.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        count() as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND role = 'maker'
      GROUP BY wallet
      HAVING cnt > 20
        AND countIf(trade_time >= now() - INTERVAL 30 DAY) > 0
        ${maxTradesFilter}
      ORDER BY wallet
      ${limitClause}
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({ wallet: r.wallet, tradeCount: Number(r.cnt) }));
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

  for (const w of wallets) {
    tradesByWallet.set(w, []);
  }

  for (const row of rows) {
    const wallet = row.wallet.toLowerCase();
    const trades = tradesByWallet.get(wallet);
    if (trades) {
      trades.push(row);
    }
  }

  return tradesByWallet;
}

async function loadTakerCounts(client: any, wallets: string[]): Promise<Map<string, { makerCount: number; takerCount: number }>> {
  const walletList = wallets.map((w) => `'${w}'`).join(',');
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          lower(trader_wallet) as wallet,
          event_id,
          any(role) as role
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) IN (${walletList})
          AND is_deleted = 0
        GROUP BY wallet, event_id
      )
      SELECT
        wallet,
        countIf(role = 'maker') as maker_count,
        countIf(role = 'taker') as taker_count
      FROM deduped
      GROUP BY wallet
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

    // Calculate position-level PnL for profit factor
    let positionPnl = pos.realizedPnl;
    const payout = resolutions.get(tokenId);

    if (pos.amount > 0) {
      if (payout !== undefined) {
        // Resolved position - calculate unrealized PnL
        const unrealizedForPos = pos.amount * (payout - pos.avgPrice);
        unrealizedPnl += unrealizedForPos;
        positionPnl += unrealizedForPos;
      } else {
        // Unresolved position - track cost basis as open exposure
        unresolvedPositionCost += pos.amount * pos.avgPrice;
      }
    }

    // Track wins vs losses
    if (positionPnl > 0) {
      winningPnl += positionPnl;
      winCount++;
    } else if (positionPnl < 0) {
      losingPnl += Math.abs(positionPnl);
      lossCount++;
    }
  }

  // Profit Factor = sum(wins) / sum(losses), handle edge cases
  const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : (winningPnl > 0 ? 999 : 1);

  // Exclusion ratios
  const externalSellsRatio = totalSells > 0 ? externalSells / totalSells : 0;
  const enginePnl = realizedPnl + unrealizedPnl;
  const openExposureRatio = unresolvedPositionCost / Math.max(Math.abs(enginePnl), 1);

  return {
    wallet,
    enginePnl,
    realizedPnl,
    unrealizedPnl,
    tradeCount: trades.length,
    positionCount: positions.size,
    externalSells,
    winningPnl,
    losingPnl,
    profitFactor,
    winCount,
    lossCount,
    totalSells,
    externalSellsRatio,
    unresolvedPositionCost,
    openExposureRatio,
    takerRatio,
  };
}

async function createOrMigrateCacheTable(client: any): Promise<void> {
  // Create table if not exists (idempotent)
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_engine_pnl_cache (
        wallet String,
        engine_pnl Float64,
        realized_pnl Float64,
        unrealized_pnl Float64,
        trade_count UInt32,
        position_count UInt32,
        external_sells Float64,
        winning_pnl Float64,
        losing_pnl Float64,
        profit_factor Float64,
        win_count UInt32,
        loss_count UInt32,
        total_sells Float64 DEFAULT 0,
        external_sells_ratio Float64 DEFAULT 0,
        unresolved_position_cost Float64 DEFAULT 0,
        open_exposure_ratio Float64 DEFAULT 0,
        taker_ratio Float64 DEFAULT 0,
        computed_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(computed_at)
      ORDER BY wallet
    `,
  });

  // Add new columns if table existed before this update
  const newColumns = [
    'profit_factor Float64 DEFAULT 0',
    'total_sells Float64 DEFAULT 0',
    'external_sells_ratio Float64 DEFAULT 0',
    'unresolved_position_cost Float64 DEFAULT 0',
    'open_exposure_ratio Float64 DEFAULT 0',
    'taker_ratio Float64 DEFAULT 0',
  ];

  for (const col of newColumns) {
    const colName = col.split(' ')[0];
    try {
      await client.command({
        query: `ALTER TABLE pm_wallet_engine_pnl_cache ADD COLUMN IF NOT EXISTS ${col}`,
      });
    } catch {
      // Column already exists, ignore
    }
  }

  console.log('Cache table ready (with exclusion ratio columns)');
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
  const args = process.argv.slice(2);
  const sampleArg = args.find((a) => a.startsWith('--sample='));
  const offsetArg = args.find((a) => a.startsWith('--offset='));
  const maxTradesArg = args.find((a) => a.startsWith('--maxTrades='));

  const sampleSize = sampleArg ? parseInt(sampleArg.split('=')[1]) : undefined;
  const offset = offsetArg ? parseInt(offsetArg.split('=')[1]) : 0;
  const maxTrades = maxTradesArg ? parseInt(maxTradesArg.split('=')[1]) : 50000; // Default: skip whales

  const client = getClickHouseClient();

  console.log('=== BATCH ENGINE PNL COMPUTATION ===\n');
  console.log(`Max trades per wallet: ${maxTrades.toLocaleString()} (--maxTrades to change)\n`);

  // Create or migrate cache table
  await createOrMigrateCacheTable(client);

  // Load resolutions once
  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  // Get wallets to process (with trade count filter)
  console.log('Getting active wallets...');
  const walletInfos = await getActiveWallets(client, sampleSize, offset, maxTrades);
  console.log(`Processing ${walletInfos.length.toLocaleString()} wallets (offset=${offset})\n`);

  if (walletInfos.length === 0) {
    console.log('No wallets to process');
    return;
  }

  // Process in batches
  const startTime = Date.now();
  let processed = 0;
  let totalPnl = 0;
  let profitable = 0;

  const allResults: WalletPnlResult[] = [];

  for (let i = 0; i < walletInfos.length; i += BATCH_SIZE) {
    const batchInfos = walletInfos.slice(i, i + BATCH_SIZE);
    const batch = batchInfos.map((w) => w.wallet);

    try {
      // Load trades and taker counts for this batch
      const tradesByWallet = await loadWalletTrades(client, batch);
      const takerCounts = await loadTakerCounts(client, batch);

      // Compute PnL for each wallet
      for (const info of batchInfos) {
        const trades = tradesByWallet.get(info.wallet) || [];
        const counts = takerCounts.get(info.wallet) || { makerCount: 0, takerCount: 0 };
        const totalTrades = counts.makerCount + counts.takerCount;
        const takerRatio = totalTrades > 0 ? counts.takerCount / totalTrades : 0;
        const result = computeWalletPnl(info.wallet, trades, resolutions, takerRatio);
        allResults.push(result);

        totalPnl += result.enginePnl;
        if (result.enginePnl > 0) profitable++;
        processed++;
      }

      // Progress update (short line to avoid terminal wrapping)
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const total = walletInfos.length;
      const pct = ((processed / total) * 100).toFixed(1);
      const eta = total > processed ? ((total - processed) / rate) : 0;

      process.stdout.write(`\r${processed}/${total} (${pct}%) | ${rate.toFixed(0)}/s | ETA ${eta.toFixed(0)}s     `);

    } catch (e) {
      console.error(`\nError processing batch at ${i}: ${e}`);
    }
  }

  console.log('\n\nInserting results to cache...');
  await insertResults(client, allResults);
  console.log('Done!\n');

  // Summary stats
  console.log('=== SUMMARY ===\n');
  console.log(`Total wallets processed: ${processed.toLocaleString()}`);
  console.log(`Profitable (PnL > 0): ${profitable.toLocaleString()} (${((profitable/processed)*100).toFixed(1)}%)`);
  console.log(`Total PnL: $${(totalPnl/1000000).toFixed(2)}M`);
  console.log(`Average PnL: $${(totalPnl/processed).toFixed(0)}`);

  // Distribution
  const pnlBuckets = [
    { min: -Infinity, max: -10000, label: 'Loss >$10k' },
    { min: -10000, max: -1000, label: 'Loss $1k-$10k' },
    { min: -1000, max: 0, label: 'Loss <$1k' },
    { min: 0, max: 500, label: '$0-$500' },
    { min: 500, max: 1000, label: '$500-$1k' },
    { min: 1000, max: 5000, label: '$1k-$5k' },
    { min: 5000, max: 10000, label: '$5k-$10k' },
    { min: 10000, max: 50000, label: '$10k-$50k' },
    { min: 50000, max: 100000, label: '$50k-$100k' },
    { min: 100000, max: Infinity, label: '$100k+' },
  ];

  console.log('\nPnL Distribution:');
  for (const bucket of pnlBuckets) {
    const count = allResults.filter((r) => r.enginePnl > bucket.min && r.enginePnl <= bucket.max).length;
    if (count > 0) {
      console.log(`  ${bucket.label}: ${count.toLocaleString()} wallets`);
    }
  }

  // Top 10 by PnL
  console.log('\nTop 10 by Engine PnL:');
  const sorted = allResults.sort((a, b) => b.enginePnl - a.enginePnl);
  for (const r of sorted.slice(0, 10)) {
    const pnl = r.enginePnl >= 0 ? `$${(r.enginePnl/1000).toFixed(0)}k` : `-$${(Math.abs(r.enginePnl)/1000).toFixed(0)}k`;
    console.log(`  ${r.wallet.slice(0, 12)}.. | ${pnl.padStart(8)} | ${r.tradeCount} trades`);
  }

  // Profit Factor distribution
  console.log('\nProfit Factor Distribution:');
  const pfLt1 = allResults.filter((r) => r.profitFactor < 1);
  const pfGt1 = allResults.filter((r) => r.profitFactor >= 1 && r.profitFactor < 2);
  const pfGt2 = allResults.filter((r) => r.profitFactor >= 2 && r.profitFactor < 5);
  const pfGt5 = allResults.filter((r) => r.profitFactor >= 5);
  console.log(`  PF < 1 (more losses): ${pfLt1.length.toLocaleString()} wallets`);
  console.log(`  PF 1-2: ${pfGt1.length.toLocaleString()} wallets`);
  console.log(`  PF 2-5: ${pfGt2.length.toLocaleString()} wallets`);
  console.log(`  PF 5+ (mostly winners): ${pfGt5.length.toLocaleString()} wallets`);

  // Copy-trading filter counts with profit factor
  console.log('\n\nCopy-Trading Pool (PnL + Profit Factor filters):');

  const pool500 = allResults.filter((r) => r.enginePnl > 500);
  const pool500_pf1 = pool500.filter((r) => r.profitFactor > 1);
  const pool1k = allResults.filter((r) => r.enginePnl > 1000);
  const pool1k_pf1 = pool1k.filter((r) => r.profitFactor > 1);
  const pool5k = allResults.filter((r) => r.enginePnl > 5000);
  const pool5k_pf1 = pool5k.filter((r) => r.profitFactor > 1);
  const pool10k = allResults.filter((r) => r.enginePnl > 10000);
  const pool10k_pf1 = pool10k.filter((r) => r.profitFactor > 1);

  console.log(`  PnL > $500: ${pool500.length.toLocaleString()} wallets (${pool500_pf1.length.toLocaleString()} with PF > 1)`);
  console.log(`  PnL > $1k: ${pool1k.length.toLocaleString()} wallets (${pool1k_pf1.length.toLocaleString()} with PF > 1)`);
  console.log(`  PnL > $5k: ${pool5k.length.toLocaleString()} wallets (${pool5k_pf1.length.toLocaleString()} with PF > 1)`);
  console.log(`  PnL > $10k: ${pool10k.length.toLocaleString()} wallets (${pool10k_pf1.length.toLocaleString()} with PF > 1)`);

  // Top by profit factor (with min PnL)
  console.log('\nTop 10 by Profit Factor (min $500 PnL):');
  const qualifiedByPF = allResults.filter((r) => r.enginePnl > 500).sort((a, b) => b.profitFactor - a.profitFactor);
  for (const r of qualifiedByPF.slice(0, 10)) {
    const pnl = r.enginePnl >= 0 ? `$${(r.enginePnl/1000).toFixed(0)}k` : `-$${(Math.abs(r.enginePnl)/1000).toFixed(0)}k`;
    console.log(`  ${r.wallet.slice(0, 12)}.. | ${pnl.padStart(8)} | PF=${r.profitFactor.toFixed(2)} | ${r.winCount}W/${r.lossCount}L`);
  }

  // HIGH-CONFIDENCE EXPORT FILTER
  console.log('\n=== HIGH-CONFIDENCE REALIZED WINNERS ===');
  console.log('Filter: ext_sells <= 0.05, open_exp <= 0.25, taker <= 0.15, trades >= 50, realized > 0\n');

  const highConfidence = allResults.filter((r) =>
    r.externalSellsRatio <= 0.05 &&
    r.openExposureRatio <= 0.25 &&
    r.takerRatio <= 0.15 &&
    r.tradeCount >= 50 &&
    r.realizedPnl > 0
  ).sort((a, b) => b.realizedPnl - a.realizedPnl);

  console.log(`High-confidence wallets: ${highConfidence.length.toLocaleString()}`);

  if (highConfidence.length > 0) {
    console.log('\nTop 20 by Realized PnL (export-ready):');
    for (const r of highConfidence.slice(0, 20)) {
      const realized = `$${(r.realizedPnl/1000).toFixed(1)}k`;
      const extRatio = `${(r.externalSellsRatio * 100).toFixed(1)}%`;
      const expRatio = `${(r.openExposureRatio * 100).toFixed(1)}%`;
      const takRatio = `${(r.takerRatio * 100).toFixed(1)}%`;
      console.log(`  ${r.wallet.slice(0, 16)}.. | R=${realized.padStart(9)} | ext=${extRatio.padStart(5)} | exp=${expRatio.padStart(5)} | tkr=${takRatio.padStart(5)} | ${r.tradeCount} trades`);
    }

    // Summary stats for high-confidence pool
    const totalRealizedPnl = highConfidence.reduce((sum, r) => sum + r.realizedPnl, 0);
    const avgRealizedPnl = totalRealizedPnl / highConfidence.length;
    console.log(`\nHigh-confidence pool stats:`);
    console.log(`  Total realized PnL: $${(totalRealizedPnl / 1000000).toFixed(2)}M`);
    console.log(`  Average realized PnL: $${avgRealizedPnl.toFixed(0)}`);
    console.log(`  Median realized PnL: $${highConfidence[Math.floor(highConfidence.length / 2)]?.realizedPnl.toFixed(0) || 0}`);
  }
}

main().catch(console.error);
