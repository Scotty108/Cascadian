#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE V29 REALIZED VS DOME - TRANSFER-FREE WALLETS ONLY
 * ============================================================================
 *
 * Same test setup as validate-v11-vs-dome-no-transfers.ts for fair comparison.
 *
 * Goal: Compare V29 accuracy to V11 on the same benchmark wallets.
 *
 * Benchmark: Dome API (realized-only, sells + redeems)
 * Engine: V29 (Inventory Engine)
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';

interface DomeBenchmark {
  wallet_address: string;
  dome_realized_value: number | null;
  dome_confidence: string;
  is_placeholder: number;
}

interface ValidationResult {
  wallet: string;
  dome_realized: number;
  v29_realized: number;
  abs_error: number;
  pct_error: number;
  passed: boolean;
  threshold_used: 'pct' | 'abs';
  transfer_count: number;
  is_clean_clob: boolean;
  trade_count: number;
  split_count: number;
  merge_count: number;
  redeem_count: number;
  failure_reason?: string;
}

async function getTransferCountsBatch(client: ReturnType<typeof getClickHouseClient>, wallets: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const w of wallets) {
    result.set(w.toLowerCase(), 0);
  }

  if (wallets.length === 0) return result;

  const CHUNK_SIZE = 50;
  for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
    const chunk = wallets.slice(i, i + CHUNK_SIZE);
    try {
      const walletList = chunk.map(w => `'${w.toLowerCase()}'`).join(',');
      const query = `
        SELECT
          wallet,
          count() as cnt
        FROM (
          SELECT lower(from_address) as wallet FROM pm_erc1155_transfers WHERE lower(from_address) IN (${walletList})
          UNION ALL
          SELECT lower(to_address) as wallet FROM pm_erc1155_transfers WHERE lower(to_address) IN (${walletList})
        )
        GROUP BY wallet
      `;
      const queryResult = await client.query({ query, format: 'JSONEachRow' });
      const rows = await queryResult.json<Array<{ wallet: string; cnt: string }>>();

      for (const row of rows) {
        result.set(row.wallet.toLowerCase(), parseInt(row.cnt || '0'));
      }
    } catch (err) {
      console.error(`Error fetching transfer counts for chunk ${i}-${i + chunk.length}: ${err}`);
    }
  }

  return result;
}

async function getWalletActivity(client: ReturnType<typeof getClickHouseClient>, wallet: string): Promise<{
  trade_count: number;
  split_count: number;
  merge_count: number;
  redeem_count: number;
  total_usdc: number;
}> {
  try {
    const tradeQuery = `
      SELECT
        count() as trade_count,
        sum(usdc_amount)/1e6 as total_usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    `;
    const tradeResult = await client.query({ query: tradeQuery, format: 'JSONEachRow' });
    const tradeRows = await tradeResult.json<Array<{ trade_count: string; total_usdc: string }>>();

    let split_count = 0, merge_count = 0, redeem_count = 0;
    try {
      const ctfQuery = `
        SELECT
          event_type,
          count() as cnt
        FROM pm_ctf_events
        WHERE lower(wallet_address) = lower('${wallet}')
        GROUP BY event_type
      `;
      const ctfResult = await client.query({ query: ctfQuery, format: 'JSONEachRow' });
      const ctfRows = await ctfResult.json<Array<{ event_type: string; cnt: string }>>();
      for (const row of ctfRows) {
        if (row.event_type === 'SPLIT' || row.event_type === 'ConditionSplit') split_count = parseInt(row.cnt);
        if (row.event_type === 'MERGE' || row.event_type === 'ConditionMerge') merge_count = parseInt(row.cnt);
        if (row.event_type === 'REDEEM' || row.event_type === 'PayoutRedemption') redeem_count = parseInt(row.cnt);
      }
    } catch {
      // pm_ctf_events might not exist
    }

    return {
      trade_count: parseInt(tradeRows[0]?.trade_count || '0'),
      total_usdc: parseFloat(tradeRows[0]?.total_usdc || '0'),
      split_count,
      merge_count,
      redeem_count
    };
  } catch {
    return { trade_count: 0, split_count: 0, merge_count: 0, redeem_count: 0, total_usdc: 0 };
  }
}

// Import shared thresholds
import {
  isPassDome,
  DOME_THRESHOLDS,
  describeThresholds,
} from '../../lib/pnl/validationThresholds';

function passesThreshold(dome_realized: number, v29_realized: number): { passed: boolean; threshold_used: 'pct' | 'abs'; failureReason?: string } {
  const result = isPassDome(dome_realized, v29_realized);
  return {
    passed: result.passed,
    threshold_used: result.thresholdUsed === 'both_zero' ? 'abs' : result.thresholdUsed,
    failureReason: result.failureReason,
  };
}

function determineFailureReason(result: ValidationResult & { total_usdc?: number }): string {
  const { split_count, merge_count, trade_count, v29_realized, dome_realized, total_usdc } = result;

  if (split_count > 0 || merge_count > 0) {
    return 'CTF_COMPLEXITY';
  }

  if (Math.abs(dome_realized) >= 50000 && (trade_count < 1000 || (total_usdc || 0) < 10000)) {
    return 'PROXY_SUSPECT';
  }

  if ((v29_realized > 0 && dome_realized < 0) || (v29_realized < 0 && dome_realized > 0)) {
    return 'SIGN_DISAGREEMENT';
  }

  if (trade_count < 10) {
    return 'LOW_ACTIVITY';
  }

  return 'UNKNOWN';
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   V29 REALIZED VS DOME - TRANSFER-FREE VALIDATION');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('Config:');
  console.log(`  thresholds: ${describeThresholds(DOME_THRESHOLDS)}\n`);

  const client = getClickHouseClient();

  // Load Dome benchmarks
  console.log('📂 Loading Dome benchmarks from ClickHouse...');
  const domeQuery = `
    SELECT
      wallet_address,
      dome_realized_value,
      dome_confidence,
      is_placeholder
    FROM pm_dome_realized_benchmarks_v1
    WHERE dome_realized_value IS NOT NULL
      AND is_placeholder = 0
      AND dome_confidence = 'high'
  `;
  const domeResult = await client.query({ query: domeQuery, format: 'JSONEachRow' });
  const domeWallets = await domeResult.json<DomeBenchmark[]>();

  console.log(`📊 Loaded ${domeWallets.length} high-confidence Dome benchmarks\n`);

  // Step 1: Get transfer counts for all wallets in ONE batch query
  console.log('🔍 Fetching transfer counts (batch query)...');
  const allWalletAddresses = domeWallets.map(w => w.wallet_address);
  const transferCounts = await getTransferCountsBatch(client, allWalletAddresses);

  // Filter to transfer-free wallets
  const transferFreeWallets: (DomeBenchmark & { transfer_count: number })[] = [];
  for (const w of domeWallets) {
    const count = transferCounts.get(w.wallet_address.toLowerCase()) || 0;
    if (count === 0) {
      transferFreeWallets.push({ ...w, transfer_count: count });
    }
  }

  console.log(`✅ Found ${transferFreeWallets.length} transfer-free wallets (from ${domeWallets.length} total)\n`);

  // Step 2: Preload V29 data for all wallets
  console.log('🔄 Preloading V29 data for all wallets...');
  const walletList = transferFreeWallets.map(w => w.wallet_address.toLowerCase());
  const v29Data = await preloadV29Data(walletList);
  console.log(`✅ Preloaded data for ${walletList.length} wallets\n`);

  // Step 3: Validate V29 against Dome
  console.log('🔄 Running V29 validation against Dome...\n');

  const results: ValidationResult[] = [];

  for (let i = 0; i < transferFreeWallets.length; i++) {
    const w = transferFreeWallets[i];
    const wallet = w.wallet_address.toLowerCase();
    const dome_realized = w.dome_realized_value!;

    process.stdout.write(`\r[${i + 1}/${transferFreeWallets.length}] Testing ${wallet.slice(0, 10)}...`);

    try {
      // Get wallet activity
      const activity = await getWalletActivity(client, wallet);

      // Get preloaded events
      const events = v29Data.eventsByWallet.get(wallet) || [];

      // Calculate V29 PnL with preloaded data
      const v29Result = await calculateV29PnL(wallet, {
        inventoryGuard: true,
        preload: {
          events,
          resolutionPrices: v29Data.resolutionPrices,
        },
      });

      const v29_realized = v29Result.realizedPnl ?? 0;

      const abs_error = Math.abs(v29_realized - dome_realized);
      const pct_error = Math.abs(dome_realized) > 0 ? (abs_error / Math.abs(dome_realized)) * 100 : (abs_error > 0 ? 100 : 0);

      const { passed, threshold_used, failureReason: thresholdFailure } = passesThreshold(dome_realized, v29_realized);
      const is_clean_clob = activity.split_count === 0 && activity.merge_count === 0;

      const result: ValidationResult = {
        wallet,
        dome_realized,
        v29_realized,
        abs_error,
        pct_error,
        passed,
        threshold_used,
        transfer_count: 0,
        is_clean_clob,
        trade_count: activity.trade_count,
        split_count: activity.split_count,
        merge_count: activity.merge_count,
        redeem_count: activity.redeem_count,
      };

      if (!passed) {
        // Use threshold failure reason if it's a sign disagreement, otherwise determine from context
        result.failure_reason = thresholdFailure === 'SIGN_DISAGREEMENT'
          ? thresholdFailure
          : determineFailureReason({ ...result, total_usdc: activity.total_usdc });
      }

      results.push(result);
    } catch (err) {
      console.error(`\n❌ Error for ${wallet}: ${err}`);
    }
  }

  console.log('\n\n════════════════════════════════════════════════════════════');
  console.log('   RESULTS SUMMARY - V29 REALIZED VS DOME');
  console.log('════════════════════════════════════════════════════════════\n');

  // Overall stats
  const totalPass = results.filter(r => r.passed).length;
  console.log('OVERALL (transfer-free):');
  console.log(`  Total: ${results.length}`);
  console.log(`  Passed: ${totalPass}/${results.length} (${(totalPass/Math.max(results.length,1)*100).toFixed(1)}%)`);

  // By size bucket
  const large = results.filter(r => Math.abs(r.dome_realized) >= 200);
  const small = results.filter(r => Math.abs(r.dome_realized) < 200);
  const largePassed = large.filter(r => r.passed).length;
  const smallPassed = small.filter(r => r.passed).length;

  console.log('\nLARGE WALLETS (|Dome| >= $200) - 6% threshold:');
  console.log(`  Count: ${large.length}`);
  console.log(`  Passed: ${largePassed}/${large.length} (${(largePassed/Math.max(large.length,1)*100).toFixed(1)}%)`);
  if (large.length > 0) {
    console.log(`  Median pct error: ${median(large.map(r => r.pct_error)).toFixed(2)}%`);
  }

  console.log('\nSMALL WALLETS (|Dome| < $200) - $10 threshold:');
  console.log(`  Count: ${small.length}`);
  console.log(`  Passed: ${smallPassed}/${small.length} (${(smallPassed/Math.max(small.length,1)*100).toFixed(1)}%)`);

  // Clean CLOB only stats
  const cleanClob = results.filter(r => r.is_clean_clob);
  const cleanClobPassed = cleanClob.filter(r => r.passed).length;

  console.log('\nCLEAN CLOB ONLY (no splits/merges):');
  console.log(`  Count: ${cleanClob.length}`);
  console.log(`  Passed: ${cleanClobPassed}/${cleanClob.length} (${(cleanClobPassed/Math.max(cleanClob.length,1)*100).toFixed(1)}%)`);

  // Show best matches
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   TOP 10 BEST MATCHES');
  console.log('════════════════════════════════════════════════════════════\n');

  const sorted = [...results].sort((a, b) => a.abs_error - b.abs_error);
  console.log('Wallet                                     | Dome         | V29          | Abs Err  | Pct  | Pass');
  console.log('-------------------------------------------|--------------|--------------|----------|------|-----');
  for (let i = 0; i < 10 && i < sorted.length; i++) {
    const r = sorted[i];
    const pass = r.passed ? '✓' : '✗';
    console.log(
      `${r.wallet} | $${r.dome_realized.toFixed(2).padStart(10)} | $${r.v29_realized.toFixed(2).padStart(10)} | $${r.abs_error.toFixed(2).padStart(6)} | ${r.pct_error.toFixed(1).padStart(4)}% | ${pass}`
    );
  }

  // Show failures
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('   FAILURE ANALYSIS');
    console.log('════════════════════════════════════════════════════════════\n');

    // Group by reason
    const byReason = new Map<string, ValidationResult[]>();
    for (const f of failures) {
      const reason = f.failure_reason || 'UNKNOWN';
      if (!byReason.has(reason)) byReason.set(reason, []);
      byReason.get(reason)!.push(f);
    }

    console.log('Reason Distribution:');
    for (const [reason, wallets] of byReason.entries()) {
      console.log(`  ${reason}: ${wallets.length} wallets`);
    }

    console.log('\nTop 10 Failures:');
    console.log('Wallet                                     | Dome         | V29          | Abs Err    | Reason');
    console.log('-------------------------------------------|--------------|--------------|------------|------------------');
    const sortedFailures = [...failures].sort((a, b) => b.abs_error - a.abs_error);
    for (let i = 0; i < 10 && i < sortedFailures.length; i++) {
      const r = sortedFailures[i];
      console.log(
        `${r.wallet} | $${r.dome_realized.toFixed(2).padStart(10)} | $${r.v29_realized.toFixed(2).padStart(10)} | $${r.abs_error.toFixed(0).padStart(8)} | ${r.failure_reason}`
      );
    }
  }

  // Save results
  const outputFile = 'tmp/v29_vs_dome_no_transfers_validation.json';
  fs.writeFileSync(outputFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    benchmark_source: 'pm_dome_realized_benchmarks_v1',
    engine: 'V29 (Inventory Engine)',
    summary: {
      total_wallets: results.length,
      passed: totalPass,
      pass_rate: totalPass / Math.max(results.length, 1),
      large_wallet_pass_rate: largePassed / Math.max(large.length, 1),
      small_wallet_pass_rate: smallPassed / Math.max(small.length, 1),
      clean_clob_pass_rate: cleanClobPassed / Math.max(cleanClob.length, 1),
      target: 0.90
    },
    results
  }, null, 2));

  console.log(`\n✅ Results saved to ${outputFile}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
