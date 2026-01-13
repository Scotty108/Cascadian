/**
 * WIO Positions Rebuild with V1 Net-Flow Formula
 *
 * Fixes the phantom token bug by using net-flow calculations instead of
 * tracking buys/sells separately. This is the same approach used in pnlEngineV1.
 *
 * Key changes:
 * - Uses sum(tokens_delta) for net_tokens (can be negative)
 * - Uses sum(usdc_delta) for net_cash (can be negative)
 * - Self-fill deduplication: excludes maker side of self-fills
 * - PnL calculated from net flows, not buy/sell tracking
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
  clickhouse_settings: {
    max_execution_time: 600,
    max_bytes_before_external_group_by: 5000000000,
    max_bytes_before_external_sort: 5000000000,
  },
});

// Generate all 256 two-character hex prefixes
function generateBatches(): string[] {
  const batches: string[] = [];
  for (let i = 0; i < 256; i++) {
    batches.push(i.toString(16).padStart(2, '0'));
  }
  return batches;
}

interface BatchResult {
  batch: string;
  success: boolean;
  duration: number;
  positionsAdded?: number;
  error?: string;
}

async function createNewTable(): Promise<void> {
  console.log('Creating new table wio_positions_v2...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS wio_positions_v2 (
        position_id UInt64,
        wallet_id String,
        condition_id String,
        outcome_index UInt8,
        market_id String DEFAULT '',
        side String,
        category String DEFAULT '',

        -- Timestamps
        ts_open DateTime,
        ts_close Nullable(DateTime),
        ts_resolve Nullable(DateTime),
        end_ts DateTime,

        -- V1 NET-FLOW APPROACH (key change from v1)
        net_tokens Float64,           -- sum(tokens_delta) - can be negative
        net_cash Float64,             -- sum(usdc_delta) - can be negative

        -- Derived metrics for compatibility
        qty_shares_opened Float64,    -- abs(net_tokens) when positive
        qty_shares_closed Float64,    -- 0 (not tracked separately)
        qty_shares_remaining Float64, -- net_tokens
        cost_usd Float64,             -- abs(net_cash) when negative
        proceeds_usd Float64,         -- net_cash when positive
        fees_usd Float64 DEFAULT 0,

        -- Entry price
        p_entry_side Float64,

        -- Anchor prices for CLV
        p_anchor_4h_side Nullable(Float64),
        p_anchor_24h_side Nullable(Float64),
        p_anchor_72h_side Nullable(Float64),

        -- Resolution
        is_resolved UInt8 DEFAULT 0,
        outcome_side Nullable(UInt8),

        -- PnL (calculated from net flows)
        pnl_usd Float64 DEFAULT 0,
        roi Float64 DEFAULT 0,

        -- Time metrics
        hold_minutes Int64 DEFAULT 0,

        -- CLV metrics
        clv_4h Nullable(Float64),
        clv_24h Nullable(Float64),
        clv_72h Nullable(Float64),

        -- Brier score
        brier_score Nullable(Float64),

        -- Fill tracking
        fills_count Int32 DEFAULT 0,
        first_fill_id String DEFAULT '',
        last_fill_id String DEFAULT '',

        -- Metadata
        created_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (wallet_id, condition_id, outcome_index)
    `,
  });

  console.log('Table wio_positions_v2 created.');
}

async function processBatch(batchPrefix: string): Promise<BatchResult> {
  const startTime = Date.now();

  try {
    // V1 Net-Flow Formula - same approach as pnlEngineV1
    const query = `
      INSERT INTO wio_positions_v2 (
        position_id, wallet_id, condition_id, outcome_index, market_id, side,
        ts_open, ts_close, end_ts,
        net_tokens, net_cash,
        qty_shares_opened, qty_shares_closed, qty_shares_remaining,
        cost_usd, proceeds_usd,
        p_entry_side, fills_count, first_fill_id, last_fill_id
      )
      SELECT
        -- Generate position ID from wallet + condition + outcome
        cityHash64(concat(wallet_id, condition_id, toString(outcome_index))) as position_id,
        wallet_id,
        condition_id,
        outcome_index,
        '' as market_id,
        if(net_tokens >= 0, 'YES', 'NO') as side,
        ts_open,
        ts_close,
        if(ts_close IS NULL, ts_open, ts_close) as end_ts,

        -- Net flow values
        net_tokens,
        net_cash,

        -- Derived metrics for compatibility
        if(net_tokens > 0, net_tokens, 0) as qty_shares_opened,
        0 as qty_shares_closed,
        net_tokens as qty_shares_remaining,
        if(net_cash < 0, abs(net_cash), 0) as cost_usd,
        if(net_cash > 0, net_cash, 0) as proceeds_usd,

        -- Entry price: cost per token (when buying)
        if(net_tokens > 0 AND net_cash < 0, abs(net_cash) / net_tokens, 0) as p_entry_side,

        fills_count,
        first_fill_id,
        last_fill_id
      FROM (
        SELECT
          wallet as wallet_id,
          condition_id,
          outcome_index,

          -- V1 NET-FLOW APPROACH
          sum(tokens_delta) as net_tokens,
          sum(usdc_delta) as net_cash,

          min(event_time) as ts_open,
          max(event_time) as ts_close,
          count() as fills_count,
          min(fill_id) as first_fill_id,
          max(fill_id) as last_fill_id
        FROM pm_canonical_fills_v4
        WHERE substring(wallet, 3, 2) = '${batchPrefix}'
          AND condition_id != ''
          -- Self-fill deduplication: exclude maker side
          AND NOT (is_self_fill = 1 AND is_maker = 1)
        GROUP BY wallet, condition_id, outcome_index
        -- Only include positions with actual token movement
        HAVING abs(net_tokens) > 0.0001 OR abs(net_cash) > 0.01
      )
    `;

    await clickhouse.command({ query });

    const duration = (Date.now() - startTime) / 1000;
    return { batch: batchPrefix, success: true, duration };
  } catch (err: any) {
    const duration = (Date.now() - startTime) / 1000;
    return {
      batch: batchPrefix,
      success: false,
      duration,
      error: err.message?.substring(0, 200)
    };
  }
}

async function getPositionCount(): Promise<number> {
  const result = await clickhouse.query({
    query: 'SELECT count() as cnt FROM wio_positions_v2',
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return Number(rows[0]?.cnt || 0);
}

async function getCompletedBatches(): Promise<Set<string>> {
  // Check which batches have data by sampling wallet prefixes
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT substring(wallet_id, 3, 2) as prefix
      FROM wio_positions_v2
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return new Set(rows.map(r => r.prefix));
}

async function main() {
  const batches = generateBatches();
  const results: BatchResult[] = [];
  const failed: string[] = [];

  console.log('======================================================================');
  console.log('WIO Positions Rebuild - V1 Net-Flow Formula (RESUME MODE)');
  console.log('======================================================================');
  console.log(`Total batches: ${batches.length}`);
  console.log('======================================================================\n');

  // Create the new table (if not exists)
  await createNewTable();

  // Check for completed batches
  const completedBatches = await getCompletedBatches();
  console.log(`Found ${completedBatches.size} already completed batches, skipping...\n`);

  const startTime = Date.now();
  let completed = 0;
  let skipped = 0;

  for (const batch of batches) {
    // Skip if already done
    if (completedBatches.has(batch)) {
      skipped++;
      continue;
    }
    completed++;
    const pct = ((completed / batches.length) * 100).toFixed(1);
    process.stdout.write(`[${completed}/${batches.length} ${pct}%] Batch ${batch}... `);

    const result = await processBatch(batch);
    results.push(result);

    if (result.success) {
      console.log(`OK (${result.duration.toFixed(1)}s)`);
    } else {
      console.log(`FAIL (${result.duration.toFixed(1)}s)`);
      console.log(`  >> Error: ${result.error}`);
      failed.push(batch);
    }

    // Progress update every 10 batches
    if (completed % 10 === 0) {
      const posCount = await getPositionCount();
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(posCount / elapsed);
      console.log(`  >> Positions: ${posCount.toLocaleString()} | Rate: ${rate}/s`);
    }
  }

  // Retry failed batches once
  if (failed.length > 0) {
    console.log(`\n======================================================================`);
    console.log(`Retrying ${failed.length} failed batches...`);
    console.log('======================================================================\n');

    for (const batch of failed) {
      process.stdout.write(`[RETRY] Batch ${batch}... `);
      const result = await processBatch(batch);

      if (result.success) {
        console.log(`OK (${result.duration.toFixed(1)}s)`);
        // Remove from failed list
        const idx = failed.indexOf(batch);
        if (idx > -1) failed.splice(idx, 1);
      } else {
        console.log(`FAIL again: ${result.error}`);
      }
    }
  }

  // Final summary
  const finalCount = await getPositionCount();
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n======================================================================');
  console.log('REBUILD COMPLETE');
  console.log('======================================================================');
  console.log(`Total positions: ${finalCount.toLocaleString()}`);
  console.log(`Total time: ${totalTime} minutes`);
  console.log(`Successful batches: ${results.filter(r => r.success).length}/${batches.length}`);
  console.log(`Failed batches: ${failed.length}`);
  if (failed.length > 0) {
    console.log(`Failed batch IDs: ${failed.join(', ')}`);
  }
  console.log('======================================================================\n');

  // Verify with sample wallet
  console.log('Verifying with test wallet 0xfc6d...');
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        round(sum(net_cash +
          CASE
            WHEN is_resolved = 1 AND outcome_side = outcome_index THEN net_tokens
            WHEN is_resolved = 1 THEN 0
            ELSE net_tokens * 0.5  -- placeholder for mark price
          END
        ), 2) as approx_pnl,
        count() as positions
      FROM wio_positions_v2
      WHERE wallet_id = '0xfc6dfe0ce7f3903dd9d4fa56ca20449052799f36'
    `,
    format: 'JSONEachRow',
  });
  const vr = (await verifyResult.json()) as any[];
  console.log(`Test wallet result: ${JSON.stringify(vr[0])}`);

  await clickhouse.close();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
