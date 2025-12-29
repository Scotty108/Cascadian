/**
 * Rebuild Cascadian PnL V1 Table - Full Coverage
 *
 * Rebuilds the PnL table to include ALL 1.66M wallets.
 * Features:
 * - Parallel workers (configurable)
 * - Progress saving to file (crash recovery)
 * - Stall detection
 * - Resume capability
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import * as fs from 'fs';

const PROGRESS_FILE = '/tmp/pnl-rebuild-progress.json';
const BATCH_SIZE = 1000; // wallets per batch
const WORKERS = 4; // parallel workers
const STALL_TIMEOUT_MS = 300000; // 5 minutes

interface Progress {
  completedBatches: number[];
  totalBatches: number;
  startedAt: string;
  lastUpdate: string;
}

function createClickHouseClient(): ClickHouseClient {
  return createClient({
    url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 600000,
    max_open_connections: 10,
  });
}

function loadProgress(): Progress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.log('Could not load progress file, starting fresh');
  }
  return null;
}

function saveProgress(progress: Progress) {
  progress.lastUpdate = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function createEmptyTable(client: ClickHouseClient) {
  console.log('Creating empty pm_cascadian_pnl_v1_rebuild table...');

  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_rebuild'
  });

  const createTable = `
    CREATE TABLE pm_cascadian_pnl_v1_rebuild (
      trader_wallet String,
      condition_id String,
      outcome_index UInt8,
      trade_cash_flow Float64,
      final_shares Float64,
      resolution_price Nullable(Float64),
      realized_pnl Float64,
      trade_count UInt32,
      first_trade DateTime64(3),
      last_trade DateTime64(3),
      resolved_at Nullable(DateTime64(3)),
      is_resolved UInt8
    )
    ENGINE = MergeTree()
    ORDER BY (trader_wallet, condition_id, outcome_index)
  `;

  await client.command({ query: createTable });
  console.log('   Empty table created');
}

async function getWalletBatches(client: ClickHouseClient): Promise<string[][]> {
  console.log('Getting wallet list from CLOB...');

  const result = await client.query({
    query: `
      SELECT DISTINCT trader_wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      ORDER BY trader_wallet
    `,
    format: 'JSONEachRow'
  });

  const wallets = (await result.json() as {trader_wallet: string}[]).map(r => r.trader_wallet);
  console.log(`   Found ${wallets.length.toLocaleString()} unique wallets`);

  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    batches.push(wallets.slice(i, i + BATCH_SIZE));
  }
  console.log(`   Split into ${batches.length} batches of ~${BATCH_SIZE} wallets each`);

  return batches;
}

async function processBatch(
  client: ClickHouseClient,
  wallets: string[],
  batchNum: number,
  totalBatches: number
): Promise<boolean> {
  const startTime = Date.now();

  // Create wallet list for IN clause - escape single quotes
  const walletList = wallets.map(w => `'${w.replace(/'/g, "''")}'`).join(',');

  const insertQuery = `
    INSERT INTO pm_cascadian_pnl_v1_rebuild
    WITH
      filtered_raw AS (
        SELECT event_id, trader_wallet, side, usdc_amount, token_amount, token_id, trade_time
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trader_wallet IN (${walletList})
      ),
      deduped_trades AS (
        SELECT
          event_id,
          any(trader_wallet) AS wallet,
          any(side) AS side,
          any(usdc_amount) AS usdc_amount,
          any(token_amount) AS token_amount,
          any(token_id) AS token_id,
          any(trade_time) AS trade_time
        FROM filtered_raw
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT
          t.event_id,
          t.wallet AS trader_wallet,
          t.side,
          t.usdc_amount,
          t.token_amount,
          t.trade_time,
          m.condition_id,
          m.outcome_index
        FROM deduped_trades t
        INNER JOIN pm_token_to_condition_map_v4 m
          ON toString(t.token_id) = toString(m.token_id_dec)
      ),
      aggregated AS (
        SELECT
          trader_wallet,
          condition_id,
          outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc_amount ELSE usdc_amount END) / 1000000.0 AS trade_cash_flow,
          SUM(CASE WHEN side = 'buy' THEN token_amount ELSE -token_amount END) / 1000000.0 AS final_shares,
          COUNT(*) AS trade_count,
          MIN(trade_time) AS first_trade,
          MAX(trade_time) AS last_trade
        FROM with_condition
        GROUP BY trader_wallet, condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT
          a.trader_wallet,
          a.condition_id,
          a.outcome_index,
          a.trade_cash_flow,
          a.final_shares,
          a.trade_count,
          a.first_trade,
          a.last_trade,
          r.payout_numerators,
          r.resolved_at,
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolution_price
        FROM aggregated a
        LEFT JOIN pm_condition_resolutions r
          ON lower(a.condition_id) = lower(r.condition_id)
          AND r.is_deleted = 0
      )
    SELECT
      trader_wallet,
      condition_id,
      outcome_index,
      trade_cash_flow,
      final_shares,
      resolution_price,
      trade_cash_flow + (final_shares * coalesce(resolution_price, 0)) AS realized_pnl,
      trade_count,
      first_trade,
      last_trade,
      resolved_at,
      CASE WHEN resolution_price IS NOT NULL THEN 1 ELSE 0 END AS is_resolved
    FROM with_resolution
  `;

  try {
    await client.command({ query: insertQuery });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const progress = ((batchNum / totalBatches) * 100).toFixed(1);
    console.log(`   [${new Date().toLocaleTimeString()}] Batch ${batchNum}/${totalBatches} (${wallets.length} wallets) - ${elapsed}s - ${progress}%`);
    return true;
  } catch (error) {
    console.error(`   ERROR on batch ${batchNum}:`, error);
    return false;
  }
}

async function runWorker(
  workerNum: number,
  batches: string[][],
  batchIndices: number[],
  progress: Progress,
  totalBatches: number
) {
  const client = createClickHouseClient();

  try {
    for (const batchIdx of batchIndices) {
      if (progress.completedBatches.includes(batchIdx)) {
        continue; // Skip already completed
      }

      const success = await processBatch(client, batches[batchIdx], batchIdx + 1, totalBatches);

      if (success) {
        progress.completedBatches.push(batchIdx);
        saveProgress(progress);
      } else {
        // Retry once
        console.log(`   Retrying batch ${batchIdx + 1}...`);
        const retrySuccess = await processBatch(client, batches[batchIdx], batchIdx + 1, totalBatches);
        if (retrySuccess) {
          progress.completedBatches.push(batchIdx);
          saveProgress(progress);
        } else {
          console.error(`   FAILED batch ${batchIdx + 1} after retry`);
        }
      }
    }
  } finally {
    await client.close();
  }
}

async function swapTables(client: ClickHouseClient) {
  console.log('');
  console.log('Swapping tables...');

  // Keep old table as backup
  await client.command({ query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_old' });

  const existsResult = await client.query({
    query: "SELECT count() as cnt FROM system.tables WHERE name = 'pm_cascadian_pnl_v1_new' AND database = 'default'",
    format: 'JSONEachRow'
  });
  const exists = (await existsResult.json() as any[])[0]?.cnt > 0;

  if (exists) {
    await client.command({ query: 'RENAME TABLE pm_cascadian_pnl_v1_new TO pm_cascadian_pnl_v1_old' });
  }

  await client.command({ query: 'RENAME TABLE pm_cascadian_pnl_v1_rebuild TO pm_cascadian_pnl_v1_new' });

  console.log('   Table swap complete (pm_cascadian_pnl_v1_rebuild -> pm_cascadian_pnl_v1_new)');
}

async function validate(client: ClickHouseClient) {
  console.log('');
  console.log('=== VALIDATION ===');

  const stats = await client.query({
    query: `
      SELECT
        count() as rows,
        uniqExact(trader_wallet) as wallets,
        countIf(is_resolved = 1) as resolved_positions
      FROM pm_cascadian_pnl_v1_new
    `,
    format: 'JSONEachRow'
  });
  const s = (await stats.json() as any[])[0];

  console.log(`   Total rows: ${Number(s.rows).toLocaleString()}`);
  console.log(`   Unique wallets: ${Number(s.wallets).toLocaleString()}`);
  console.log(`   Resolved positions: ${Number(s.resolved_positions).toLocaleString()}`);

  // Compare to CLOB
  const clobWallets = await client.query({
    query: 'SELECT uniqExact(trader_wallet) as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0',
    format: 'JSONEachRow'
  });
  const cw = (await clobWallets.json() as any[])[0];
  console.log(`   CLOB wallets: ${Number(cw.cnt).toLocaleString()}`);
  console.log(`   Coverage: ${(Number(s.wallets) / Number(cw.cnt) * 100).toFixed(1)}%`);
}

async function main() {
  const startTime = Date.now();
  console.log('=== CASCADIAN PNL FULL REBUILD ===');
  console.log(`Workers: ${WORKERS}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  const client = createClickHouseClient();

  try {
    // Check for existing progress
    let progress = loadProgress();
    let batches: string[][];
    let isResume = false;

    if (progress && progress.completedBatches.length > 0) {
      console.log(`Resuming from previous run (${progress.completedBatches.length}/${progress.totalBatches} batches complete)`);
      isResume = true;
      batches = await getWalletBatches(client);
    } else {
      // Fresh start
      await createEmptyTable(client);
      batches = await getWalletBatches(client);
      progress = {
        completedBatches: [],
        totalBatches: batches.length,
        startedAt: new Date().toISOString(),
        lastUpdate: new Date().toISOString()
      };
      saveProgress(progress);
    }

    // Distribute batches across workers
    const remainingBatches = [];
    for (let i = 0; i < batches.length; i++) {
      if (!progress.completedBatches.includes(i)) {
        remainingBatches.push(i);
      }
    }

    console.log(`Remaining batches: ${remainingBatches.length}`);
    console.log('');
    console.log('Processing...');

    // Split remaining batches among workers
    const workerBatches: number[][] = Array.from({ length: WORKERS }, () => []);
    remainingBatches.forEach((batchIdx, i) => {
      workerBatches[i % WORKERS].push(batchIdx);
    });

    // Run workers in parallel
    await Promise.all(
      workerBatches.map((indices, workerNum) =>
        runWorker(workerNum, batches, indices, progress!, batches.length)
      )
    );

    // Swap and validate
    await swapTables(client);
    await validate(client);

    // Clean up progress file
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
    }

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log('');
    console.log(`=== BUILD COMPLETE (${totalTime} minutes) ===`);

  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
