/**
 * Backfill Wallet Engine PnL Cache
 *
 * Resumable backfill script that populates missing taker_ratio and exclusion fields
 * for wallets in pm_wallet_engine_pnl_cache.
 *
 * Features:
 * - Seek pagination (stable ordering by wallet address)
 * - Checkpoint-based resumption
 * - Per-batch timeouts with retries
 * - Dynamic batch sizing on failure
 * - Skipped wallet tracking
 *
 * Usage:
 *   npx tsx scripts/pnl/backfill-wallet-engine-pnl-cache.ts [options]
 *
 * Options:
 *   --limit=N           Max wallets to process this run (default: unlimited)
 *   --maxTrades=N       Skip wallets with more than N trades (default: 50000)
 *   --batchSize=N       Starting batch size (default: 100)
 *   --checkpointFile=P  Path to checkpoint file (default: tmp/backfill_checkpoint.json)
 *   --reset             Clear checkpoint and start fresh
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '../../lib/pnl/loadResolutionsStrict';

// Cutoff timestamp for new fields
const NEW_FIELDS_CUTOFF = '2025-12-17 00:00:00';

// Timeout for individual batch queries (60 seconds)
const BATCH_QUERY_TIMEOUT_MS = 60000;

interface Checkpoint {
  lastWallet: string;
  processedCount: number;
  skippedCount: number;
  startTime: string;
  lastUpdateTime: string;
}

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

interface SkippedWallet {
  wallet: string;
  tradeCount: number;
  reason: string;
  timestamp: string;
}

function loadCheckpoint(checkpointFile: string): Checkpoint | null {
  try {
    if (fs.existsSync(checkpointFile)) {
      const data = fs.readFileSync(checkpointFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to load checkpoint:', e);
  }
  return null;
}

function saveCheckpoint(checkpointFile: string, checkpoint: Checkpoint): void {
  fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
}

function appendSkippedWallet(skippedFile: string, entry: SkippedWallet): void {
  fs.appendFileSync(skippedFile, JSON.stringify(entry) + '\n');
}

function appendProgressLog(logFile: string, message: string): void {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

async function getWalletsMissingNewFields(
  client: any,
  lastWallet: string,
  limit: number,
  maxTrades: number
): Promise<Array<{ wallet: string; tradeCount: number }>> {
  // Get wallets from cache that need updating, using seek pagination
  const result = await client.query({
    query: `
      WITH cached_wallets AS (
        SELECT wallet
        FROM pm_wallet_engine_pnl_cache FINAL
        WHERE computed_at < '${NEW_FIELDS_CUTOFF}' OR taker_ratio = 0
      ),
      active_wallets AS (
        SELECT
          lower(trader_wallet) as wallet,
          count() as cnt
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND role = 'maker'
        GROUP BY wallet
        HAVING cnt > 20
          AND cnt <= ${maxTrades}
          AND countIf(trade_time >= now() - INTERVAL 30 DAY) > 0
      )
      SELECT aw.wallet, aw.cnt as trade_count
      FROM active_wallets aw
      INNER JOIN cached_wallets cw ON aw.wallet = cw.wallet
      WHERE aw.wallet > '${lastWallet}'
      ORDER BY aw.wallet
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    wallet: r.wallet,
    tradeCount: Number(r.trade_count),
  }));
}

async function countMissingCoverage(client: any, maxTrades: number): Promise<number> {
  const result = await client.query({
    query: `
      WITH cached_wallets AS (
        SELECT wallet
        FROM pm_wallet_engine_pnl_cache FINAL
        WHERE computed_at < '${NEW_FIELDS_CUTOFF}' OR taker_ratio = 0
      ),
      active_wallets AS (
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND role = 'maker'
        GROUP BY wallet
        HAVING count() > 20
          AND count() <= ${maxTrades}
          AND countIf(trade_time >= now() - INTERVAL 30 DAY) > 0
      )
      SELECT count() as cnt
      FROM active_wallets aw
      INNER JOIN cached_wallets cw ON aw.wallet = cw.wallet
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return Number(rows[0]?.cnt || 0);
}

async function loadWalletTradesWithTimeout(
  client: any,
  wallets: string[],
  timeoutMs: number
): Promise<Map<string, any[]>> {
  const walletList = wallets.map((w) => `'${w}'`).join(',');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
      abort_signal: controller.signal,
    });

    clearTimeout(timeoutId);
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
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error('Query timeout');
    }
    throw e;
  }
}

async function loadTakerCountsWithTimeout(
  client: any,
  wallets: string[],
  timeoutMs: number
): Promise<Map<string, { makerCount: number; takerCount: number }>> {
  const walletList = wallets.map((w) => `'${w}'`).join(',');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
      abort_signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const rows = (await result.json()) as any[];
    const countsByWallet = new Map<string, { makerCount: number; takerCount: number }>();

    for (const row of rows) {
      countsByWallet.set(row.wallet.toLowerCase(), {
        makerCount: Number(row.maker_count),
        takerCount: Number(row.taker_count),
      });
    }

    return countsByWallet;
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error('Query timeout');
    }
    throw e;
  }
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

    if (positionPnl > 0) {
      winningPnl += positionPnl;
      winCount++;
    } else if (positionPnl < 0) {
      losingPnl += Math.abs(positionPnl);
      lossCount++;
    }
  }

  const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? 999 : 1;
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

  const limitArg = args.find((a) => a.startsWith('--limit='));
  const maxTradesArg = args.find((a) => a.startsWith('--maxTrades='));
  const batchSizeArg = args.find((a) => a.startsWith('--batchSize='));
  const checkpointArg = args.find((a) => a.startsWith('--checkpointFile='));
  const resetFlag = args.includes('--reset');

  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
  const maxTrades = maxTradesArg ? parseInt(maxTradesArg.split('=')[1]) : 50000;
  let batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;
  const checkpointFile = checkpointArg
    ? checkpointArg.split('=')[1]
    : path.join(process.cwd(), 'tmp', 'backfill_checkpoint.json');
  const skippedFile = path.join(process.cwd(), 'tmp', 'backfill_skipped_wallets.jsonl');
  const progressLog = path.join(process.cwd(), 'tmp', 'backfill_progress.log');

  // Ensure tmp directory exists
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  console.log('=== BACKFILL WALLET ENGINE PNL CACHE ===\n');
  console.log(`Max trades per wallet: ${maxTrades.toLocaleString()}`);
  console.log(`Starting batch size: ${batchSize}`);
  console.log(`Checkpoint file: ${checkpointFile}`);
  console.log(`Limit: ${limit === Infinity ? 'unlimited' : limit.toLocaleString()}`);
  console.log('');

  // Load or initialize checkpoint
  let checkpoint: Checkpoint;
  if (resetFlag || !loadCheckpoint(checkpointFile)) {
    checkpoint = {
      lastWallet: '',
      processedCount: 0,
      skippedCount: 0,
      startTime: new Date().toISOString(),
      lastUpdateTime: new Date().toISOString(),
    };
    console.log('Starting fresh backfill');
  } else {
    checkpoint = loadCheckpoint(checkpointFile)!;
    console.log(`Resuming from checkpoint: ${checkpoint.processedCount} processed, last wallet: ${checkpoint.lastWallet.slice(0, 12)}...`);
  }

  const client = getClickHouseClient();

  // Count missing coverage
  console.log('\nCounting wallets missing coverage...');
  const missingCount = await countMissingCoverage(client, maxTrades);
  console.log(`Wallets missing new fields: ${missingCount.toLocaleString()}`);

  if (missingCount === 0) {
    console.log('\nNo wallets to backfill!');
    return;
  }

  // Load resolutions
  console.log('\nLoading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  const startTime = Date.now();
  let processedThisRun = 0;
  let skippedThisRun = 0;
  let currentBatchSize = batchSize;
  const minBatchSize = 10;

  appendProgressLog(progressLog, `Backfill started. Missing: ${missingCount}, Limit: ${limit}`);

  while (processedThisRun < limit) {
    // Fetch next batch of wallets
    const walletInfos = await getWalletsMissingNewFields(
      client,
      checkpoint.lastWallet,
      Math.min(currentBatchSize, limit - processedThisRun),
      maxTrades
    );

    if (walletInfos.length === 0) {
      console.log('\nNo more wallets to process');
      break;
    }

    const wallets = walletInfos.map((w) => w.wallet);
    let success = false;
    let retries = 0;
    const maxRetries = 2;

    while (!success && retries <= maxRetries) {
      try {
        // Load trades and taker counts with timeout
        const tradesByWallet = await loadWalletTradesWithTimeout(client, wallets, BATCH_QUERY_TIMEOUT_MS);
        const takerCounts = await loadTakerCountsWithTimeout(client, wallets, BATCH_QUERY_TIMEOUT_MS);

        // Compute PnL for each wallet
        const results: WalletPnlResult[] = [];
        for (const info of walletInfos) {
          const trades = tradesByWallet.get(info.wallet) || [];
          const counts = takerCounts.get(info.wallet) || { makerCount: 0, takerCount: 0 };
          const totalTrades = counts.makerCount + counts.takerCount;
          const takerRatio = totalTrades > 0 ? counts.takerCount / totalTrades : 0;
          const result = computeWalletPnl(info.wallet, trades, resolutions, takerRatio);
          results.push(result);
        }

        // Insert results
        await insertResults(client, results);

        // Update checkpoint
        checkpoint.lastWallet = wallets[wallets.length - 1];
        checkpoint.processedCount += wallets.length;
        checkpoint.lastUpdateTime = new Date().toISOString();
        saveCheckpoint(checkpointFile, checkpoint);

        processedThisRun += wallets.length;
        success = true;

        // If we succeeded with reduced batch size, try to recover
        if (currentBatchSize < batchSize) {
          currentBatchSize = Math.min(currentBatchSize * 2, batchSize);
        }

        // Progress output
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processedThisRun / elapsed;
        const remaining = Math.min(limit - processedThisRun, missingCount - checkpoint.processedCount);
        const eta = remaining > 0 ? remaining / rate : 0;
        const pct = limit === Infinity
          ? ((checkpoint.processedCount / missingCount) * 100).toFixed(1)
          : ((processedThisRun / limit) * 100).toFixed(1);

        process.stdout.write(`\r${checkpoint.processedCount} done (${pct}%) | ${rate.toFixed(1)}/s | ETA ${Math.round(eta)}s     `);

      } catch (e: any) {
        retries++;
        const errorMsg = e.message || String(e);

        if (retries <= maxRetries) {
          // Reduce batch size and retry
          currentBatchSize = Math.max(Math.floor(currentBatchSize / 2), minBatchSize);
          console.log(`\nBatch failed (${errorMsg}), retrying with batch size ${currentBatchSize}...`);

          // Re-fetch with smaller batch
          const smallerBatch = wallets.slice(0, currentBatchSize);
          // Clear wallets array and try again with smaller set on next iteration
          continue;
        } else {
          // Skip these wallets and move on
          for (const info of walletInfos) {
            appendSkippedWallet(skippedFile, {
              wallet: info.wallet,
              tradeCount: info.tradeCount,
              reason: errorMsg,
              timestamp: new Date().toISOString(),
            });
            checkpoint.skippedCount++;
            skippedThisRun++;
          }

          // Move past these wallets
          checkpoint.lastWallet = wallets[wallets.length - 1];
          checkpoint.lastUpdateTime = new Date().toISOString();
          saveCheckpoint(checkpointFile, checkpoint);

          console.log(`\nSkipped ${walletInfos.length} wallets after ${maxRetries} retries`);
          success = true; // Move on
        }
      }
    }
  }

  // Final summary
  console.log('\n\n=== BACKFILL COMPLETE ===\n');
  console.log(`Processed this run: ${processedThisRun.toLocaleString()}`);
  console.log(`Skipped this run: ${skippedThisRun.toLocaleString()}`);
  console.log(`Total processed (all runs): ${checkpoint.processedCount.toLocaleString()}`);
  console.log(`Total skipped (all runs): ${checkpoint.skippedCount.toLocaleString()}`);

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nElapsed time: ${(elapsed / 60).toFixed(1)} minutes`);

  appendProgressLog(
    progressLog,
    `Backfill finished. Processed: ${processedThisRun}, Skipped: ${skippedThisRun}, Total: ${checkpoint.processedCount}`
  );

  // Check remaining
  const remainingCount = await countMissingCoverage(client, maxTrades);
  console.log(`\nRemaining wallets needing coverage: ${remainingCount.toLocaleString()}`);

  if (remainingCount === 0) {
    console.log('\nBackfill complete! All wallets have new fields.');
  } else {
    console.log('\nTo continue, run this script again (it will resume from checkpoint).');
  }
}

main().catch((e) => {
  console.error('\nBackfill failed:', e);
  process.exit(1);
});
