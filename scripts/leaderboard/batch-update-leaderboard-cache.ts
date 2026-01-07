/**
 * Batch Update Leaderboard Cache
 *
 * Pipeline:
 * 1. Get all candidate wallets (SQL filter)
 * 2. Process in chunks of 50
 * 3. Run CCR-v1 on each wallet
 * 4. Insert results to pm_wallet_pnl_leaderboard_cache
 *
 * Designed to run as cron job every 6-12 hours.
 * ~4-6 hours for 20k wallets with parallel processing.
 *
 * Usage:
 *   npx tsx scripts/leaderboard/batch-update-leaderboard-cache.ts [--limit N] [--workers N]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';

const TABLE_NAME = 'pm_wallet_pnl_leaderboard_cache';
const CHUNK_SIZE = 50;
const DEFAULT_WORKERS = 4;
const MIN_MARKETS = 10;

interface CacheEntry {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  volume_traded: number;
  avg_return_pct: number;
  win_rate: number;
  win_count: number;
  loss_count: number;
  positions_count: number;
  resolved_count: number;
  external_sell_ratio: number;
  pnl_confidence: string;
  markets_last_30d: number;
  last_trade_time: string;
}

async function getCandidateWallets(limit?: number): Promise<string[]> {
  console.log('\n[1/4] Getting candidate wallets...');

  const query = `
    SELECT
      lower(trader_wallet) as wallet,
      countDistinct(token_id) as markets,
      max(trade_time) as last_trade
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND role = 'maker'
      AND trade_time >= now() - INTERVAL 60 DAY
    GROUP BY wallet
    HAVING markets >= ${MIN_MARKETS}
    ORDER BY markets DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as { wallet: string }[];

  console.log(`  Found ${rows.length} candidates`);
  return rows.map((r) => r.wallet);
}

async function processWallet(wallet: string): Promise<CacheEntry | null> {
  try {
    const ccr = await computeCCRv1(wallet);

    const avgReturn =
      ccr.volume_traded > 0 ? (ccr.realized_pnl / ccr.volume_traded) * 100 : 0;

    return {
      wallet,
      realized_pnl: ccr.realized_pnl,
      unrealized_pnl: ccr.unrealized_pnl,
      total_pnl: ccr.total_pnl,
      volume_traded: ccr.volume_traded,
      avg_return_pct: avgReturn,
      win_rate: ccr.win_rate,
      win_count: ccr.win_count,
      loss_count: ccr.loss_count,
      positions_count: ccr.positions_count,
      resolved_count: ccr.resolved_count,
      external_sell_ratio: ccr.external_sell_ratio,
      pnl_confidence: ccr.pnl_confidence,
      markets_last_30d: ccr.positions_count,
      last_trade_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
  } catch (e) {
    return null;
  }
}

async function insertBatch(entries: CacheEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const values = entries
    .map(
      (e) =>
        `('${e.wallet}', ${e.realized_pnl}, ${e.unrealized_pnl}, ${e.total_pnl}, ` +
        `${e.volume_traded}, ${e.avg_return_pct}, ${e.win_rate}, ` +
        `${e.win_count}, ${e.loss_count}, ${e.positions_count}, ${e.resolved_count}, ` +
        `${e.external_sell_ratio}, '${e.pnl_confidence}', ${e.markets_last_30d}, ` +
        `'${e.last_trade_time}', now())`
    )
    .join(',\n');

  const query = `
    INSERT INTO ${TABLE_NAME}
    (wallet, realized_pnl, unrealized_pnl, total_pnl, volume_traded, avg_return_pct,
     win_rate, win_count, loss_count, positions_count, resolved_count,
     external_sell_ratio, pnl_confidence, markets_last_30d, last_trade_time, computed_at)
    VALUES ${values}
  `;

  await clickhouse.command({ query });
}

async function processChunk(
  wallets: string[],
  chunkIndex: number,
  totalChunks: number
): Promise<CacheEntry[]> {
  const results: CacheEntry[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const globalPct = (
      ((chunkIndex * CHUNK_SIZE + i + 1) / (totalChunks * CHUNK_SIZE)) *
      100
    ).toFixed(1);

    process.stdout.write(
      `\r  [${globalPct}%] Chunk ${chunkIndex + 1}/${totalChunks} | Wallet ${i + 1}/${wallets.length}`
    );

    const entry = await processWallet(wallet);
    if (entry) {
      results.push(entry);
    }
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const workersArg = args.find((a) => a.startsWith('--workers='));

  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const workers = workersArg
    ? parseInt(workersArg.split('=')[1])
    : DEFAULT_WORKERS;

  console.log('='.repeat(80));
  console.log('LEADERBOARD CACHE BATCH UPDATE');
  console.log('='.repeat(80));
  console.log(`\nSettings: ${limit || 'all'} wallets, ${workers} workers`);

  const startTime = Date.now();

  // Step 1: Get candidates
  const wallets = await getCandidateWallets(limit);

  if (wallets.length === 0) {
    console.log('No candidates found.');
    return;
  }

  // Step 2: Process in chunks
  console.log('\n[2/4] Processing wallets with CCR-v1...');
  const chunks: string[][] = [];
  for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
    chunks.push(wallets.slice(i, i + CHUNK_SIZE));
  }

  console.log(`  ${chunks.length} chunks of ${CHUNK_SIZE} wallets`);
  console.log(`  Estimated time: ${Math.round((wallets.length * 3) / 60)} minutes\n`);

  let totalProcessed = 0;
  let totalInserted = 0;

  for (let c = 0; c < chunks.length; c++) {
    const entries = await processChunk(chunks[c], c, chunks.length);
    totalProcessed += chunks[c].length;

    // Step 3: Insert to cache
    if (entries.length > 0) {
      await insertBatch(entries);
      totalInserted += entries.length;
    }

    process.stdout.write(
      ` | Inserted: ${totalInserted} | Rate: ${(totalProcessed / ((Date.now() - startTime) / 1000)).toFixed(1)}/s`
    );
  }

  // Step 4: Summary
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('\n\n[3/4] Optimizing table...');
  await clickhouse.command({ query: `OPTIMIZE TABLE ${TABLE_NAME} FINAL` });

  console.log('\n[4/4] Summary');
  console.log('-'.repeat(40));
  console.log(`  Candidates processed: ${totalProcessed}`);
  console.log(`  Entries cached: ${totalInserted}`);
  console.log(`  Time elapsed: ${elapsed}s (${(elapsed / 60).toFixed(1)} min)`);
  console.log(`  Rate: ${(totalProcessed / elapsed).toFixed(1)} wallets/sec`);

  // Show top results
  console.log('\n' + '='.repeat(80));
  console.log('TOP 10 BY AVG RETURN %');
  console.log('='.repeat(80));

  const topQuery = `
    SELECT wallet, realized_pnl, avg_return_pct, win_rate, pnl_confidence
    FROM ${TABLE_NAME}
    WHERE realized_pnl > 200
    ORDER BY avg_return_pct DESC
    LIMIT 10
  `;

  const topRes = await clickhouse.query({ query: topQuery, format: 'JSONEachRow' });
  const topRows = (await topRes.json()) as any[];

  console.log('\nRank | Wallet                                     | PnL        | Avg Return | Win Rate');
  console.log('-'.repeat(95));

  topRows.forEach((r, i) => {
    console.log(
      String(i + 1).padStart(4) +
        ' | ' +
        r.wallet.padEnd(42) +
        ' | ' +
        ('$' + Number(r.realized_pnl).toFixed(0)).padStart(10) +
        ' | ' +
        (Number(r.avg_return_pct).toFixed(1) + '%').padStart(10) +
        ' | ' +
        ((Number(r.win_rate) * 100).toFixed(0) + '%').padStart(8)
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
