#!/usr/bin/env npx tsx
/**
 * Build ALL Unresolved Positions
 * Complete coverage - not just last 24 hours
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function buildAllUnresolved() {
  const startTime = Date.now();
  console.log('🔄 Building ALL Unresolved Positions (Complete Coverage)\n');

  // Step 1: Find ALL wallets with unresolved positions
  console.log('1️⃣ Finding all wallets with unresolved positions...');
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND tokens_delta > 0
        AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions)
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsResult.json<{ wallet: string }>();
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} wallets with unresolved positions\n`);

  // Step 2: Process in batches
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);
  console.log(`2️⃣ Processing ${totalBatches} batches...\n`);

  for (let i = 0; i < totalBatches; i++) {
    const batch = wallets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const walletList = batch.map(w => `'${w.wallet}'`).join(',');

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

    if ((i + 1) % 50 === 0 || i === totalBatches - 1) {
      const pct = ((i + 1) / totalBatches * 100).toFixed(1);
      console.log(`   Batch ${i + 1}/${totalBatches} (${pct}%)...`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ ALL UNRESOLVED POSITIONS COMPLETE! (${elapsed} minutes)\n`);

  // Final stats
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        uniq(wallet) as wallets
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];

  console.log('📊 FINAL STATE:');
  console.log(`   Total: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(final.wallets).toLocaleString()}\n`);
}

buildAllUnresolved().catch(console.error);
