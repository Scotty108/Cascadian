/**
 * ============================================================================
 * ⚠️  EXPERIMENTAL - DO NOT USE FOR PRODUCTION
 * ============================================================================
 *
 * This V2 rebuild is DEPRECATED. Use V20 engine instead:
 *   - Production engine: lib/pnl/uiActivityEngineV20.ts
 *   - Test harness: scripts/pnl/v20-regression-test.ts
 *
 * KNOWN ISSUES WITH V2:
 *   - Overcounts PnL by including AMM/FPMM trades that are already in CLOB
 *   - Leaks PnL into empty wallets due to redemption attribution bugs
 *   - Does not match Polymarket UI for top leaderboard wallets
 *
 * V20 is validated to within 0.01-2% of Polymarket UI and cross-checked
 * against PolymarketAnalytics.com.
 *
 * ============================================================================
 *
 * Original description (for historical reference):
 * Rebuild Cascadian PnL V2 Table - Enhanced PnL calculation that includes:
 * - CLOB trades (pm_trader_events_v2)
 * - PayoutRedemption events (pm_ctf_events)
 * - FPMM/AMM trades (pm_fpmm_trades)
 *
 * Formula: realized_pnl = trade_cash_flow + redemption_payout + (unredeemed_shares * resolution_price)
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import * as fs from 'fs';

const PROGRESS_FILE = '/tmp/pnl-v2-rebuild-progress.json';
const BATCH_SIZE = 1000; // Using pre-aggregated redemption table for speed
const WORKERS = 4;

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
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
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
  console.log('Creating empty pm_cascadian_pnl_v2_rebuild table...');

  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v2_rebuild'
  });

  const createTable = `
    CREATE TABLE pm_cascadian_pnl_v2_rebuild (
      trader_wallet String,
      condition_id String,
      outcome_index UInt8,
      trade_cash_flow Float64,
      final_shares Float64,
      redemption_payout Float64,
      resolution_price Nullable(Float64),
      realized_pnl Float64,
      trade_count UInt32,
      first_trade DateTime64(3),
      last_trade DateTime64(3),
      resolved_at Nullable(DateTime64(3)),
      is_resolved UInt8,
      has_redemption UInt8
    )
    ENGINE = MergeTree()
    ORDER BY (trader_wallet, condition_id, outcome_index)
  `;

  await client.command({ query: createTable });
  console.log('   Empty table created');
}

async function getWalletBatches(client: ClickHouseClient): Promise<string[][]> {
  console.log('Getting wallet list from all sources...');

  // Union of wallets from CLOB, CTF events, and FPMM
  const result = await client.query({
    query: `
      SELECT DISTINCT wallet FROM (
        SELECT trader_wallet as wallet FROM pm_trader_events_v2 WHERE is_deleted = 0
        UNION ALL
        SELECT user_address as wallet FROM pm_ctf_events WHERE event_type = 'PayoutRedemption'
        UNION ALL
        SELECT trader_wallet as wallet FROM pm_fpmm_trades WHERE is_deleted = 0
      )
      ORDER BY wallet
    `,
    format: 'JSONEachRow'
  });

  const wallets = (await result.json() as {wallet: string}[]).map(r => r.wallet);
  console.log(`   Found ${wallets.length.toLocaleString()} unique wallets across all sources`);

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
  const walletList = wallets.map(w => `'${w.replace(/'/g, "''")}'`).join(',');

  // This query combines:
  // 1. CLOB trades -> positions and cash flows
  // 2. PayoutRedemption events -> redemption payouts
  // 3. Resolution prices
  const insertQuery = `
    INSERT INTO pm_cascadian_pnl_v2_rebuild
    WITH
      -- CLOB trades: aggregate by wallet/condition/outcome
      clob_raw AS (
        SELECT event_id, trader_wallet, side, usdc_amount, token_amount, token_id, trade_time
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trader_wallet IN (${walletList})
      ),
      clob_deduped AS (
        SELECT
          event_id,
          any(trader_wallet) AS wallet,
          any(side) AS side,
          any(usdc_amount) AS usdc_amount,
          any(token_amount) AS token_amount,
          any(token_id) AS token_id,
          any(trade_time) AS trade_time
        FROM clob_raw
        GROUP BY event_id
      ),
      clob_with_condition AS (
        SELECT
          t.wallet AS trader_wallet,
          m.condition_id,
          m.outcome_index,
          CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END / 1000000.0 AS cash_delta,
          CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END / 1000000.0 AS shares_delta,
          t.trade_time
        FROM clob_deduped t
        INNER JOIN pm_token_to_condition_map_v4 m
          ON toString(t.token_id) = toString(m.token_id_dec)
      ),
      clob_aggregated AS (
        SELECT
          trader_wallet,
          condition_id,
          outcome_index,
          SUM(cash_delta) AS trade_cash_flow,
          SUM(shares_delta) AS final_shares,
          COUNT(*) AS trade_count,
          MIN(trade_time) AS first_trade,
          MAX(trade_time) AS last_trade
        FROM clob_with_condition
        GROUP BY trader_wallet, condition_id, outcome_index
      ),

      -- Redemption payouts from pre-aggregated table (much faster)
      redemptions AS (
        SELECT
          wallet,
          condition_id,
          redemption_payout
        FROM pm_redemption_payouts_agg
        WHERE wallet IN (SELECT lower(w) FROM (SELECT arrayJoin([${walletList}]) as w))
      ),

      -- Combine CLOB positions with redemptions
      -- IMPORTANT: Only add redemption_payout to outcome_index=0 to avoid double-counting
      combined AS (
        SELECT
          coalesce(c.trader_wallet, r.wallet) AS trader_wallet,
          coalesce(c.condition_id, r.condition_id) AS condition_id,
          coalesce(c.outcome_index, 0) AS outcome_index,
          coalesce(c.trade_cash_flow, 0) AS trade_cash_flow,
          coalesce(c.final_shares, 0) AS final_shares,
          -- Only add redemption to outcome_index=0 to avoid duplication
          CASE WHEN coalesce(c.outcome_index, 0) = 0 THEN coalesce(r.redemption_payout, 0) ELSE 0 END AS redemption_payout,
          coalesce(c.trade_count, 0) AS trade_count,
          c.first_trade,
          c.last_trade
        FROM clob_aggregated c
        FULL OUTER JOIN redemptions r
          ON lower(c.trader_wallet) = lower(r.wallet)
          AND lower(c.condition_id) = lower(r.condition_id)
      ),

      -- Add resolution prices
      with_resolution AS (
        SELECT
          c.trader_wallet,
          c.condition_id,
          c.outcome_index,
          c.trade_cash_flow,
          c.final_shares,
          c.redemption_payout,
          c.trade_count,
          c.first_trade,
          c.last_trade,
          r.payout_numerators,
          r.resolved_at,
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND c.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND c.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND c.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND c.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolution_price
        FROM combined c
        LEFT JOIN pm_condition_resolutions r
          ON lower(c.condition_id) = lower(r.condition_id)
          AND r.is_deleted = 0
      )
    SELECT
      trader_wallet,
      condition_id,
      outcome_index,
      trade_cash_flow,
      final_shares,
      redemption_payout,
      resolution_price,
      -- PnL formula: cash_flow + (shares * resolution_price) + redemption_payout
      -- Validated against Theo NegRisk benchmark with 1.9% error
      -- Note: redemption_payout is at condition level, apportioned to winning outcome
      trade_cash_flow + (final_shares * coalesce(resolution_price, 0)) + redemption_payout AS realized_pnl,
      trade_count,
      first_trade,
      last_trade,
      resolved_at,
      CASE WHEN resolution_price IS NOT NULL THEN 1 ELSE 0 END AS is_resolved,
      CASE WHEN redemption_payout > 0 THEN 1 ELSE 0 END AS has_redemption
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
        continue;
      }

      const success = await processBatch(client, batches[batchIdx], batchIdx + 1, totalBatches);

      if (success) {
        progress.completedBatches.push(batchIdx);
        saveProgress(progress);
      } else {
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

  await client.command({ query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v2_old' });

  const existsResult = await client.query({
    query: "SELECT count() as cnt FROM system.tables WHERE name = 'pm_cascadian_pnl_v2' AND database = 'default'",
    format: 'JSONEachRow'
  });
  const exists = (await existsResult.json() as any[])[0]?.cnt > 0;

  if (exists) {
    await client.command({ query: 'RENAME TABLE pm_cascadian_pnl_v2 TO pm_cascadian_pnl_v2_old' });
  }

  await client.command({ query: 'RENAME TABLE pm_cascadian_pnl_v2_rebuild TO pm_cascadian_pnl_v2' });

  console.log('   Table swap complete (pm_cascadian_pnl_v2_rebuild -> pm_cascadian_pnl_v2)');
}

async function validate(client: ClickHouseClient) {
  console.log('');
  console.log('=== VALIDATION ===');

  const stats = await client.query({
    query: `
      SELECT
        count() as rows,
        uniqExact(trader_wallet) as wallets,
        countIf(is_resolved = 1) as resolved_positions,
        countIf(has_redemption = 1) as with_redemptions,
        sum(redemption_payout) as total_redemptions
      FROM pm_cascadian_pnl_v2
    `,
    format: 'JSONEachRow'
  });
  const s = (await stats.json() as any[])[0];

  console.log(`   Total rows: ${Number(s.rows).toLocaleString()}`);
  console.log(`   Unique wallets: ${Number(s.wallets).toLocaleString()}`);
  console.log(`   Resolved positions: ${Number(s.resolved_positions).toLocaleString()}`);
  console.log(`   Positions with redemptions: ${Number(s.with_redemptions).toLocaleString()}`);
  console.log(`   Total redemption payouts: $${Number(s.total_redemptions).toLocaleString()}`);

  // Test Theo NegRisk wallet
  console.log('');
  console.log('=== THEO NEGRISK TEST ===');
  const theo = await client.query({
    query: `
      SELECT
        sum(realized_pnl) as pnl,
        sum(trade_cash_flow) as cash,
        sum(redemption_payout) as redemptions
      FROM pm_cascadian_pnl_v2
      WHERE lower(trader_wallet) = lower('0x9d36c904930a7d06c5403f9e16996e919f586486')
    `,
    format: 'JSONEachRow'
  });
  const t = (await theo.json() as any[])[0];
  console.log(`   Cash flow: $${Number(t.cash).toFixed(2)}`);
  console.log(`   Redemptions: $${Number(t.redemptions).toFixed(2)}`);
  console.log(`   V2 PnL: $${Number(t.pnl).toFixed(2)}`);
  console.log(`   UI benchmark: $-6,138.90`);
  console.log(`   Error: ${Math.abs((Number(t.pnl) - (-6138.9)) / 6138.9 * 100).toFixed(1)}%`);
}

async function main() {
  const startTime = Date.now();
  console.log('=== CASCADIAN PNL V2 REBUILD (with PayoutRedemption) ===');
  console.log(`Workers: ${WORKERS}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  const client = createClickHouseClient();

  try {
    let progress = loadProgress();
    let batches: string[][];
    let isResume = false;

    if (progress && progress.completedBatches.length > 0) {
      console.log(`Resuming from previous run (${progress.completedBatches.length}/${progress.totalBatches} batches complete)`);
      isResume = true;
      batches = await getWalletBatches(client);
    } else {
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

    const remainingBatches = [];
    for (let i = 0; i < batches.length; i++) {
      if (!progress.completedBatches.includes(i)) {
        remainingBatches.push(i);
      }
    }

    console.log(`Remaining batches: ${remainingBatches.length}`);
    console.log('');
    console.log('Processing...');

    const workerBatches: number[][] = Array.from({ length: WORKERS }, () => []);
    remainingBatches.forEach((batchIdx, i) => {
      workerBatches[i % WORKERS].push(batchIdx);
    });

    await Promise.all(
      workerBatches.map((indices, workerNum) =>
        runWorker(workerNum, batches, indices, progress!, batches.length)
      )
    );

    await swapTables(client);
    await validate(client);

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
