#!/usr/bin/env npx tsx
/**
 * Final Deduplication
 * Create clean table from pm_trade_fifo_roi_v3_mat_unified_v2
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function finalDedupe() {
  console.log('🔄 Creating Final Deduplicated Table\n');

  // Drop old deduped table if exists
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_final`
  });

  console.log('Creating deduplicated table from 995M rows...');
  const startTime = Date.now();

  // Create new clean table with deduplication
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_final
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      AS
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        any(entry_time) as entry_time,
        any(resolved_at) as resolved_at,
        any(tokens) as tokens,
        any(cost_usd) as cost_usd,
        any(tokens_sold_early) as tokens_sold_early,
        any(tokens_held) as tokens_held,
        any(exit_value) as exit_value,
        any(pnl_usd) as pnl_usd,
        any(roi) as roi,
        any(pct_sold_early) as pct_sold_early,
        any(is_maker) as is_maker,
        any(is_closed) as is_closed,
        any(is_short) as is_short
      FROM pm_trade_fifo_roi_v3_mat_unified_v2
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 3600, // 1 hour
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Deduplication complete! (${elapsed} minutes)\n`);

  // Verify
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        uniq(wallet) as wallets,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as stale_min
      FROM pm_trade_fifo_roi_v3_mat_unified_final
    `,
    format: 'JSONEachRow'
  });
  const stats = (await result.json<any>())[0];

  console.log('📊 FINAL CLEAN TABLE:');
  console.log(`   Total rows: ${parseInt(stats.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(stats.resolved).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(stats.wallets).toLocaleString()}`);
  console.log(`   Newest: ${stats.newest_resolved}`);
  console.log(`   Staleness: ${stats.stale_min} min\n`);
}

finalDedupe().catch(console.error);
