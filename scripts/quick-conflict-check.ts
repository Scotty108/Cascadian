#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function quickConflictCheck() {
  console.log('🔍 Quick Conflict Analysis...\n');

  // Check table size first
  console.log('Step 1: Checking pm_trades_canonical_v3 size...');
  const sizeResult = await clickhouse.query({
    query: `
      SELECT
        count() AS total_trades,
        count(DISTINCT wallet_address) AS unique_wallets,
        count(DISTINCT transaction_hash) AS unique_txs
      FROM pm_trades_canonical_v3
    `,
    format: 'JSONEachRow'
  });
  const size = (await sizeResult.json<any>())[0];
  console.log(`Total trades: ${size.total_trades.toLocaleString()}`);
  console.log(`Unique wallets: ${size.unique_wallets.toLocaleString()}`);
  console.log(`Unique txs: ${size.unique_txs.toLocaleString()}`);

  // Calculate expected conflicts
  const expectedConflicts = size.total_trades - size.unique_txs;
  console.log(`\nExpected conflicts (total_trades - unique_txs): ${expectedConflicts.toLocaleString()}`);

  // Sample conflicts without creating table
  console.log('\n\nStep 2: Sampling conflicts (top 100 by value)...');
  const conflictSampleResult = await clickhouse.query({
    query: `
      WITH conflicts AS (
        SELECT
          transaction_hash,
          count() AS wallet_count,
          sum(usd_value) AS total_value
        FROM pm_trades_canonical_v3
        GROUP BY transaction_hash
        HAVING wallet_count > 1
      )
      SELECT
        count() AS total_conflicts,
        sum(total_value) AS total_conflict_volume,
        max(wallet_count) AS max_wallets_per_tx,
        avg(wallet_count) AS avg_wallets_per_tx
      FROM conflicts
    `,
    format: 'JSONEachRow'
  });
  const conflictStats = (await conflictSampleResult.json<any>())[0];

  console.log(`\n📊 Conflict Statistics:`);
  console.log(`Total conflicted transactions: ${conflictStats.total_conflicts.toLocaleString()}`);
  console.log(`Total conflict volume: $${Math.round(conflictStats.total_conflict_volume).toLocaleString()}`);
  console.log(`Max wallets per tx: ${conflictStats.max_wallets_per_tx}`);
  console.log(`Avg wallets per tx: ${Math.round(conflictStats.avg_wallets_per_tx * 100) / 100}`);

  // Calculate volume to archive (keep 1 trade per tx, archive rest)
  const tradesToArchive = size.total_trades - size.unique_txs;
  const volumePerTrade = conflictStats.total_conflict_volume / (conflictStats.total_conflicts * conflictStats.avg_wallets_per_tx);
  const estimatedArchiveVolume = tradesToArchive * volumePerTrade;

  console.log(`\n📋 Deduplication Impact:`);
  console.log(`Trades to archive: ${tradesToArchive.toLocaleString()}`);
  console.log(`Estimated archive volume: $${Math.round(estimatedArchiveVolume).toLocaleString()}`);

  return {
    size,
    conflicts: conflictStats,
    dedup_impact: {
      trades_to_archive: tradesToArchive,
      estimated_volume: estimatedArchiveVolume
    }
  };
}

quickConflictCheck().catch(console.error);
