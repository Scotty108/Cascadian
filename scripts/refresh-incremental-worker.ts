#!/usr/bin/env npx tsx
/**
 * Incremental Refresh Worker (Parallel)
 *
 * Refreshes unresolved positions for wallets active in last 24 hours
 * Uses worker ID to partition wallets (no overlap)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const WORKER_ID = parseInt(process.env.WORKER_ID || '0');
const NUM_WORKERS = parseInt(process.env.NUM_WORKERS || '3');
const LOOKBACK_HOURS = 24;
const BATCH_SIZE = 100; // Smaller batches for faster progress reporting

interface WalletInfo {
  wallet: string;
}

async function refreshWorker() {
  console.log(`🔄 Worker ${WORKER_ID}/${NUM_WORKERS - 1} starting...`);
  console.log(`Lookback: ${LOOKBACK_HOURS} hours\n`);

  const startTime = Date.now();

  // Step 1: Get wallets assigned to this worker (using canonical_fills for speed)
  console.log(`1️⃣ Finding wallets for worker ${WORKER_ID}...`);
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND cityHash64(wallet) % ${NUM_WORKERS} = ${WORKER_ID}
        AND source = 'clob'
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 120,  // 2 minutes for wallet finding
    }
  });

  const wallets = (await walletsResult.json<WalletInfo>());
  console.log(`   ✅ Assigned ${wallets.length.toLocaleString()} wallets\n`);

  if (wallets.length === 0) {
    console.log('No wallets to process. Done!\n');
    return;
  }

  // Step 2: Delete old unresolved positions for these wallets (in batches to avoid query size limit)
  console.log(`2️⃣ Deleting old unresolved positions...`);

  const DELETE_BATCH_SIZE = 1000;
  const deleteBatches = Math.ceil(wallets.length / DELETE_BATCH_SIZE);

  for (let i = 0; i < wallets.length; i += DELETE_BATCH_SIZE) {
    const batch = wallets.slice(i, Math.min(i + DELETE_BATCH_SIZE, wallets.length));
    const walletList = batch.map(w => `'${w.wallet}'`).join(',');

    await clickhouse.command({
      query: `
        ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
        DELETE WHERE resolved_at IS NULL
          AND wallet IN [${walletList}]
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });

    if ((i / DELETE_BATCH_SIZE + 1) % 10 === 0) {
      console.log(`   Deleted batch ${i / DELETE_BATCH_SIZE + 1}/${deleteBatches}...`);
    }
  }

  console.log(`   ✅ Delete mutations submitted (${deleteBatches} batches)\n`);

  // Step 3: Process in batches
  console.log(`3️⃣ Rebuilding positions in batches...\n`);
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);
  let processed = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length));
    const batchWallets = batch.map(w => `'${w.wallet}'`).join(',');

    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    // LONG positions with LEFT JOIN anti-pattern
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          buys.tx_hash,
          buys.wallet,
          buys.condition_id,
          buys.outcome_index,
          buys.entry_time,
          NULL as resolved_at,
          buys.tokens,
          buys.cost_usd,
          0 as tokens_sold_early,
          buys.tokens as tokens_held,
          0 as exit_value,
          0 as pnl_usd,
          0 as roi,
          0 as pct_sold_early,
          buys.is_maker_flag as is_maker,
          0 as is_closed,
          0 as is_short
        FROM (
          SELECT
            tx_hash,
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            sum(tokens_delta) as tokens,
            sum(abs(usdc_delta)) as cost_usd,
            max(is_maker) as is_maker_flag
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${batchWallets}]
            AND source = 'clob'
            AND tokens_delta > 0
            AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY tx_hash, wallet, condition_id, outcome_index
          HAVING cost_usd >= 0.01 AND tokens >= 0.01
        ) AS buys
        LEFT JOIN pm_condition_resolutions AS r
          ON buys.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });

    // SHORT positions
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          concat('short_', substring(shorts.wallet, 1, 10), '_', substring(shorts.condition_id, 1, 10), '_', toString(shorts.outcome_index), '_', toString(toUnixTimestamp(shorts.entry_time))) as tx_hash,
          shorts.wallet,
          shorts.condition_id,
          shorts.outcome_index,
          shorts.entry_time,
          NULL as resolved_at,
          abs(shorts.net_tokens) as tokens,
          -shorts.cash_flow as cost_usd,
          0 as tokens_sold_early,
          abs(shorts.net_tokens) as tokens_held,
          0 as exit_value,
          0 as pnl_usd,
          0 as roi,
          0 as pct_sold_early,
          0 as is_maker,
          0 as is_closed,
          1 as is_short
        FROM (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            sum(tokens_delta) as net_tokens,
            sum(usdc_delta) as cash_flow
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${batchWallets}]
            AND source = 'clob'
            AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING net_tokens < -0.01 AND cash_flow > 0.01
        ) AS shorts
        LEFT JOIN pm_condition_resolutions AS r
          ON shorts.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });

    processed += batch.length;
    const pct = (processed / wallets.length * 100).toFixed(1);
    console.log(`   ✅ ${processed.toLocaleString()}/${wallets.length.toLocaleString()} (${pct}%)\n`);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Worker ${WORKER_ID} complete! (${elapsed} minutes)\n`);
}

refreshWorker().catch(console.error);
