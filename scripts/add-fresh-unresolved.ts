#!/usr/bin/env npx tsx
/**
 * Add Fresh Unresolved Positions
 * Builds and inserts unresolved positions directly into main table
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function addFreshUnresolved() {
  const startTime = Date.now();
  console.log('🔄 Building Fresh Unresolved Positions\n');
  console.log('Target table: pm_trade_fifo_roi_v3_mat_unified\n');

  // Step 1: Find active wallets (last 24 hours)
  console.log('1️⃣ Finding active wallets...');
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 24 HOUR
        AND source = 'clob'
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsResult.json<{ wallet: string }>();
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} active wallets\n`);

  // Step 2: Process in batches
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);
  console.log(`2️⃣ Processing ${totalBatches} batches...\n`);

  for (let i = 0; i < totalBatches; i++) {
    const batch = wallets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const walletList = batch.map(w => `'${w.wallet}'`).join(',');

    // Insert unresolved positions for this batch
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          tx_hash, wallet, condition_id, outcome_index,
          min(event_time) as entry_time,
          NULL as resolved_at,
          sum(tokens_delta) as tokens,
          sum(abs(usdc_delta)) as cost_usd,
          0, sum(tokens_delta), 0, -sum(abs(usdc_delta)), -1.0, 0,
          max(is_maker), 0, 0
        FROM pm_canonical_fills_v4
        WHERE wallet IN (${walletList})
          AND source = 'clob'
          AND tokens_delta > 0
          AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions)
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING sum(tokens_delta) > 0.01
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });

    if ((i + 1) % 10 === 0 || i === totalBatches - 1) {
      console.log(`   Batch ${i + 1}/${totalBatches}...`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ UNRESOLVED POSITIONS COMPLETE! (${elapsed} minutes)\n`);

  // Final verification
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        uniq(wallet) as wallets,
        max(resolved_at) as newest_resolved,
        date_diff('hour', max(resolved_at), now()) as stale_hours
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];

  console.log('📊 FINAL STATE:');
  console.log(`   Total: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(final.wallets).toLocaleString()}`);
  console.log(`   Freshness: ${final.stale_hours} hours stale\n`);
}

addFreshUnresolved().catch(console.error);
