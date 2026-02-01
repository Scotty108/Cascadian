#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function buildMissingUnresolved() {
  console.log('🔄 Building Missing Unresolved Positions\n');

  // Step 1: Count missing positions first
  console.log('1️⃣ Counting missing unresolved positions...');

  const countResult = await clickhouse.query({
    query: `
      WITH grouped_canonical AS (
        SELECT
          wallet,
          condition_id,
          outcome_index
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND tokens_delta > 0
          AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0)
        GROUP BY wallet, condition_id, outcome_index
        HAVING sum(tokens_delta) > 0.01
      )
      SELECT count() as missing_count
      FROM grouped_canonical gc
      WHERE NOT EXISTS (
        SELECT 1
        FROM pm_trade_fifo_roi_v3_mat_unified u
        WHERE u.wallet = gc.wallet
          AND u.condition_id = gc.condition_id
          AND u.outcome_index = gc.outcome_index
          AND u.resolved_at IS NULL
      )
    `,
    format: 'JSONEachRow'
  });

  const countData = await countResult.json<{ missing_count: string }>();
  const missingCount = parseInt(countData[0].missing_count);

  console.log(`   ✅ Found ${missingCount.toLocaleString()} missing positions\n`);

  if (missingCount === 0) {
    console.log('✅ No missing positions found - unified table is complete!\n');
    return;
  }

  // Step 2: Get wallets that have missing positions
  console.log('2️⃣ Finding wallets with missing positions...');

  const missingWalletsResult = await clickhouse.query({
    query: `
      WITH grouped_canonical AS (
        SELECT
          wallet,
          condition_id,
          outcome_index
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND tokens_delta > 0
          AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0)
        GROUP BY wallet, condition_id, outcome_index
        HAVING sum(tokens_delta) > 0.01
      )
      SELECT DISTINCT gc.wallet
      FROM grouped_canonical gc
      WHERE NOT EXISTS (
        SELECT 1
        FROM pm_trade_fifo_roi_v3_mat_unified u
        WHERE u.wallet = gc.wallet
          AND u.condition_id = gc.condition_id
          AND u.outcome_index = gc.outcome_index
          AND u.resolved_at IS NULL
      )
    `,
    format: 'JSONEachRow'
  });

  const missingWallets = await missingWalletsResult.json<{ wallet: string }>();
  const totalWallets = missingWallets.length;

  console.log(`   ✅ Found ${totalWallets.toLocaleString()} wallets with at least one missing position\n`);

  if (totalWallets === 0) {
    console.log('✅ No wallets with missing positions!\n');
    return;
  }

  // Step 3: Process in batches
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(totalWallets / BATCH_SIZE);

  console.log(`3️⃣ Processing ${totalBatches} batches...\n`);

  let processed = 0;

  for (let i = 0; i < totalBatches; i++) {
    const batchWallets = missingWallets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const walletList = batchWallets.map(w => `'${w.wallet}'`).join(',');

    try {
      await clickhouse.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified
          SELECT
            tx_hash,
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            NULL as resolved_at,
            sum(tokens_delta) as tokens,
            sum(abs(usdc_delta)) as cost_usd,
            0 as tokens_sold_early,
            sum(tokens_delta) as tokens_held,
            0 as exit_value,
            -sum(abs(usdc_delta)) as pnl_usd,
            -1.0 as roi,
            0 as pct_sold_early,
            max(is_maker) as is_maker,
            0 as is_short,
            0 as is_closed
          FROM pm_canonical_fills_v4
          WHERE wallet IN (${walletList})
            AND source = 'clob'
            AND tokens_delta > 0
            AND condition_id NOT IN (
              SELECT condition_id
              FROM pm_condition_resolutions
              WHERE is_deleted = 0
            )
          GROUP BY tx_hash, wallet, condition_id, outcome_index
          HAVING sum(tokens_delta) > 0.01
        `,
        clickhouse_settings: {
          max_execution_time: 300,
          send_timeout: 300,
          receive_timeout: 300
        }
      });

      processed += batchWallets.length;

      if ((i + 1) % 10 === 0 || i === totalBatches - 1) {
        const pct = ((i + 1) / totalBatches * 100).toFixed(1);
        console.log(`   Batch ${i + 1}/${totalBatches} (${pct}%)...`);
      }
    } catch (error) {
      console.error(`   ⚠️ Error in batch ${i + 1}:`, error);
      // Continue with next batch
    }
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('✅ Missing Unresolved Positions Build Complete\n');
  console.log(`📊 Results:`);
  console.log(`   - Wallets found missing: ${totalWallets.toLocaleString()}`);
  console.log(`   - Wallets processed: ${processed.toLocaleString()}`);
  console.log('════════════════════════════════════════════════════════════\n');

  // Step 4: Verify final state
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_unresolved,
        uniq(wallet, condition_id, outcome_index) as unique_positions,
        toString(max(entry_time)) as latest_entry,
        dateDiff('minute', max(entry_time), now()) as minutes_behind
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json())[0];

  console.log('📅 Updated Unresolved State:');
  console.log(`   Total rows: ${parseInt(final.total_unresolved).toLocaleString()}`);
  console.log(`   Unique positions: ${parseInt(final.unique_positions).toLocaleString()}`);
  console.log(`   Latest entry: ${final.latest_entry}`);
  console.log(`   Minutes behind: ${final.minutes_behind}\n`);

  console.log('🎉 Done!\n');
}

buildMissingUnresolved().catch(console.error);
