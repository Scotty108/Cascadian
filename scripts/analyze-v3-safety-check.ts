#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('🔍 PM Trades V3 Safety Check - v2 vs v3 Comparison');
  console.log('='.repeat(80));
  console.log('');

  // All tested partitions (safety + expanded testing)
  // Note: 202202, 202206 had 0 rows and are excluded
  const TEST_PARTITIONS = [202301, 202309, 202312, 202401, 202405, 202407, 202409, 202411, 202412, 202501, 202502];
  const xcnstrategy = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // =========================================================================
  // Part 1: Global Comparison (All Wallets)
  // =========================================================================

  console.log('📊 PART 1: GLOBAL v2 vs v3 COMPARISON');
  console.log('─'.repeat(80));
  console.log('');

  const globalQuery = `
    SELECT
      toYYYYMM(timestamp) AS partition,
      COUNT(*) as total_trades,

      -- V2 metrics
      countIf(
        condition_id_norm_v2 IS NULL
        OR condition_id_norm_v2 = ''
        OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v2_orphans,
      countIf(
        condition_id_norm_v2 IS NOT NULL
        AND condition_id_norm_v2 != ''
        AND condition_id_norm_v2 != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v2_valid,

      -- V3 metrics
      countIf(
        condition_id_norm_v3 IS NULL
        OR condition_id_norm_v3 = ''
        OR condition_id_norm_v3 = '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v3_orphans,
      countIf(
        condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
        AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v3_valid,

      -- Coverage percentages
      ROUND(100.0 * v2_valid / total_trades, 2) AS v2_coverage_pct,
      ROUND(100.0 * v3_valid / total_trades, 2) AS v3_coverage_pct,

      -- Improvement
      v3_valid - v2_valid AS improvement,
      ROUND(v3_coverage_pct - v2_coverage_pct, 2) AS improvement_pct,

      -- Trade ID uniqueness
      uniqExact(trade_id) AS unique_trade_ids
    FROM pm_trades_canonical_v3
    WHERE toYYYYMM(timestamp) IN (${TEST_PARTITIONS.join(', ')})
    GROUP BY partition
    ORDER BY partition
  `;

  const globalResult = await clickhouse.query({ query: globalQuery, format: 'JSONEachRow' });
  const globalData = await globalResult.json() as any[];

  console.log('Month      Total       v2 Valid    v2 Orphans  v2 Cov%     v3 Valid    v3 Orphans  v3 Cov%     Improvement  Unique IDs');
  console.log('─'.repeat(140));

  for (const row of globalData) {
    const month = String(row.partition);
    const total = parseInt(row.total_trades).toLocaleString().padStart(10);
    const v2Valid = parseInt(row.v2_valid).toLocaleString().padStart(10);
    const v2Orphans = parseInt(row.v2_orphans).toLocaleString().padStart(10);
    const v2Cov = parseFloat(row.v2_coverage_pct).toFixed(2).padStart(7);
    const v3Valid = parseInt(row.v3_valid).toLocaleString().padStart(10);
    const v3Orphans = parseInt(row.v3_orphans).toLocaleString().padStart(10);
    const v3Cov = parseFloat(row.v3_coverage_pct).toFixed(2).padStart(7);
    const improvement = parseInt(row.improvement).toLocaleString().padStart(11);
    const uniqueIds = parseInt(row.unique_trade_ids).toLocaleString().padStart(10);

    console.log(`${month}  ${total}  ${v2Valid}  ${v2Orphans}  ${v2Cov}%  ${v3Valid}  ${v3Orphans}  ${v3Cov}%  ${improvement}  ${uniqueIds}`);
  }

  console.log('');

  // =========================================================================
  // Part 2: xcnstrategy-Specific Comparison
  // =========================================================================

  console.log('📊 PART 2: XCNSTRATEGY WALLET v2 vs v3 COMPARISON');
  console.log('─'.repeat(80));
  console.log(`Wallet: ${xcnstrategy}`);
  console.log('');

  const walletQuery = `
    SELECT
      toYYYYMM(timestamp) AS partition,
      COUNT(*) as wallet_trades,

      -- V2 metrics
      countIf(
        condition_id_norm_v2 IS NULL
        OR condition_id_norm_v2 = ''
        OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v2_orphans,
      countIf(
        condition_id_norm_v2 IS NOT NULL
        AND condition_id_norm_v2 != ''
        AND condition_id_norm_v2 != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v2_valid,

      -- V3 metrics
      countIf(
        condition_id_norm_v3 IS NULL
        OR condition_id_norm_v3 = ''
        OR condition_id_norm_v3 = '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v3_orphans,
      countIf(
        condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
        AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v3_valid,

      -- Coverage percentages
      ROUND(100.0 * v2_valid / wallet_trades, 2) AS v2_coverage_pct,
      ROUND(100.0 * v3_valid / wallet_trades, 2) AS v3_coverage_pct,

      -- Improvement
      v3_valid - v2_valid AS improvement,
      ROUND(v3_coverage_pct - v2_coverage_pct, 2) AS improvement_pct
    FROM pm_trades_canonical_v3
    WHERE
      toYYYYMM(timestamp) IN (${TEST_PARTITIONS.join(', ')})
      AND lower(wallet_address) = {wallet:String}
    GROUP BY partition
    ORDER BY partition
  `;

  const walletResult = await clickhouse.query({
    query: walletQuery,
    query_params: { wallet: xcnstrategy.toLowerCase() },
    format: 'JSONEachRow'
  });
  const walletData = await walletResult.json() as any[];

  if (walletData.length > 0) {
    console.log('Month      Wallet      v2 Valid    v2 Orphans  v2 Cov%     v3 Valid    v3 Orphans  v3 Cov%     Improvement');
    console.log('─'.repeat(120));

    for (const row of walletData) {
      const month = String(row.partition);
      const total = parseInt(row.wallet_trades).toLocaleString().padStart(10);
      const v2Valid = parseInt(row.v2_valid).toLocaleString().padStart(10);
      const v2Orphans = parseInt(row.v2_orphans).toLocaleString().padStart(10);
      const v2Cov = parseFloat(row.v2_coverage_pct).toFixed(2).padStart(7);
      const v3Valid = parseInt(row.v3_valid).toLocaleString().padStart(10);
      const v3Orphans = parseInt(row.v3_orphans).toLocaleString().padStart(10);
      const v3Cov = parseFloat(row.v3_coverage_pct).toFixed(2).padStart(7);
      const improvement = parseInt(row.improvement).toLocaleString().padStart(11);

      console.log(`${month}  ${total}  ${v2Valid}  ${v2Orphans}  ${v2Cov}%  ${v3Valid}  ${v3Orphans}  ${v3Cov}%  ${improvement}`);
    }
  } else {
    console.log('⚠️  No trades found for xcnstrategy in these months.');
  }

  console.log('');

  // =========================================================================
  // Part 3: condition_source_v3 Breakdown
  // =========================================================================

  console.log('📊 PART 3: REPAIR SOURCE BREAKDOWN (v3)');
  console.log('─'.repeat(80));
  console.log('');

  const sourceQuery = `
    SELECT
      toYYYYMM(timestamp) AS partition,
      condition_source_v3,
      COUNT(*) as count,
      ROUND(100.0 * count / SUM(count) OVER (PARTITION BY toYYYYMM(timestamp)), 2) AS pct
    FROM pm_trades_canonical_v3
    WHERE toYYYYMM(timestamp) IN (${TEST_PARTITIONS.join(', ')})
    GROUP BY partition, condition_source_v3
    ORDER BY partition, count DESC
  `;

  const sourceResult = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' });
  const sourceData = await sourceResult.json() as any[];

  let currentMonth = '';
  for (const row of sourceData) {
    const month = String(row.partition);
    if (month !== currentMonth) {
      if (currentMonth !== '') console.log('');
      console.log(`Month ${month}:`);
      currentMonth = month;
    }
    const source = row.condition_source_v3;
    const count = parseInt(row.count).toLocaleString();
    const pct = parseFloat(row.pct).toFixed(2);
    console.log(`  ${source.padEnd(10)} ${count.padStart(10)} (${pct}%)`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('✅ SAFETY CHECK ANALYSIS COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
