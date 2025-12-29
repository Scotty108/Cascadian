#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE V11 REALIZED VS DOME - TRANSFER-FREE WALLETS ONLY
 * ============================================================================
 *
 * Goal: Achieve near-100% accuracy for realized PnL on clean CLOB-only wallets.
 *
 * Benchmark: Dome API (realized-only, sells + redeems)
 * Engine: V11 (Polymarket Subgraph Port)
 *
 * This is the correct comparison: realized vs realized.
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';
import { loadPolymarketPnlEventsForWallet, LoaderGapStats } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';

// Parse CLI args
// Default: synthetic OFF for Dome parity (A/B tested: 70.5% vs 29.5%)
// Use --with-synthetic to enable synthetic redemptions
const args = process.argv.slice(2);
const INCLUDE_SYNTHETIC_REDEMPTIONS = args.includes('--with-synthetic');
const LOG_GAP_SUMMARY = args.includes('--log-gaps');

interface DomeBenchmark {
  wallet_address: string;
  dome_realized_value: number | null;
  dome_confidence: string;
  is_placeholder: number;
}

interface ValidationResult {
  wallet: string;
  dome_realized: number;
  v11_realized: number;
  abs_error: number;
  pct_error: number;
  passed: boolean;
  threshold_used: 'pct' | 'abs';
  transfer_count: number;
  is_clean_clob: boolean;
  // Diagnostic data
  trade_count: number;
  split_count: number;
  merge_count: number;
  redeem_count: number;
  failure_reason?: string;
  // Gap stats from loader
  gap_stats?: LoaderGapStats;
}

async function getTransferCountsBatch(client: ReturnType<typeof getClickHouseClient>, wallets: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  // Initialize all wallets to 0
  for (const w of wallets) {
    result.set(w.toLowerCase(), 0);
  }

  if (wallets.length === 0) return result;

  // Process in chunks of 50 to avoid query size limits
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
    // Get trade count and volume
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

    // Get CTF events (splits, merges, redeems) from pm_ctf_events if it exists
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
      // pm_ctf_events might not exist, that's ok
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

function passesThreshold(dome_realized: number, v11_realized: number): { passed: boolean; threshold_used: 'pct' | 'abs'; failureReason?: string } {
  const result = isPassDome(dome_realized, v11_realized);
  return {
    passed: result.passed,
    threshold_used: result.thresholdUsed === 'both_zero' ? 'abs' : result.thresholdUsed,
    failureReason: result.failureReason,
  };
}

function determineFailureReason(result: ValidationResult): string {
  const { split_count, merge_count, trade_count, v11_realized, dome_realized, gap_stats } = result;
  const total_usdc = (result as ValidationResult & { total_usdc?: number }).total_usdc;

  // Check for mapping gap impact (if skipped_usdc is a significant portion of the error)
  if (gap_stats && gap_stats.skipped_usdc_abs > 0) {
    const errorMagnitude = result.abs_error;
    // If skipped USDC could explain >25% of the error
    if (gap_stats.skipped_usdc_abs >= errorMagnitude * 0.25) {
      return 'MAPPING_GAP';
    }
  }

  // Check for split/merge complexity
  if (split_count > 0 || merge_count > 0) {
    return 'CTF_COMPLEXITY';
  }

  // Check for proxy mismatch (large Dome PnL but low activity)
  if (Math.abs(dome_realized) >= 50000 && (trade_count < 1000 || (total_usdc || 0) < 10000)) {
    return 'PROXY_SUSPECT';
  }

  // Check for sign disagreement
  if ((v11_realized > 0 && dome_realized < 0) || (v11_realized < 0 && dome_realized > 0)) {
    return 'SIGN_DISAGREEMENT';
  }

  // Low activity noise
  if (trade_count < 10) {
    return 'LOW_ACTIVITY';
  }

  return 'UNKNOWN';
}

async function main() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   V11 REALIZED VS DOME - TRANSFER-FREE VALIDATION');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('Config:');
  console.log(`  includeSyntheticRedemptions: ${INCLUDE_SYNTHETIC_REDEMPTIONS}`);
  console.log(`  logGapSummary: ${LOG_GAP_SUMMARY}`);
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

  // Step 2: Validate V11 against Dome
  console.log('🔄 Running V11 validation against Dome...\n');

  const results: ValidationResult[] = [];

  for (let i = 0; i < transferFreeWallets.length; i++) {
    const w = transferFreeWallets[i];
    const wallet = w.wallet_address.toLowerCase();
    const dome_realized = w.dome_realized_value!;

    process.stdout.write(`\r[${i + 1}/${transferFreeWallets.length}] Testing ${wallet.slice(0, 10)}...`);

    try {
      // Get wallet activity
      const activity = await getWalletActivity(client, wallet);

      // Load events and compute V11 PnL (now returns { events, gapStats })
      const { events, gapStats } = await loadPolymarketPnlEventsForWallet(wallet, {
        includeSyntheticRedemptions: INCLUDE_SYNTHETIC_REDEMPTIONS,
        includeErc1155Transfers: false,
        logGapSummary: LOG_GAP_SUMMARY,
      });

      const v11Result = computeWalletPnlFromEvents(wallet, events, { mode: 'ui_like' });
      const v11_realized = v11Result.realizedPnl;

      const abs_error = Math.abs(v11_realized - dome_realized);
      const pct_error = Math.abs(dome_realized) > 0 ? (abs_error / Math.abs(dome_realized)) * 100 : (abs_error > 0 ? 100 : 0);

      const { passed, threshold_used, failureReason: thresholdFailure } = passesThreshold(dome_realized, v11_realized);
      const is_clean_clob = activity.split_count === 0 && activity.merge_count === 0;

      const result: ValidationResult = {
        wallet,
        dome_realized,
        v11_realized,
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
        gap_stats: gapStats,
      };

      if (!passed) {
        // Use threshold failure reason if it's a sign disagreement, otherwise determine from context
        result.failure_reason = thresholdFailure === 'SIGN_DISAGREEMENT'
          ? thresholdFailure
          : determineFailureReason({ ...result, total_usdc: activity.total_usdc } as any);
      }

      results.push(result);
    } catch (err) {
      console.error(`\n❌ Error for ${wallet}: ${err}`);
    }
  }

  console.log('\n\n════════════════════════════════════════════════════════════');
  console.log('   RESULTS SUMMARY - V11 REALIZED VS DOME');
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
  console.log('Wallet                                     | Dome         | V11          | Abs Err  | Pct  | Pass');
  console.log('-------------------------------------------|--------------|--------------|----------|------|-----');
  for (let i = 0; i < 10 && i < sorted.length; i++) {
    const r = sorted[i];
    const pass = r.passed ? '✓' : '✗';
    console.log(
      `${r.wallet} | $${r.dome_realized.toFixed(2).padStart(10)} | $${r.v11_realized.toFixed(2).padStart(10)} | $${r.abs_error.toFixed(2).padStart(6)} | ${r.pct_error.toFixed(1).padStart(4)}% | ${pass}`
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
    console.log('Wallet                                     | Dome         | V11          | Abs Err    | Reason');
    console.log('-------------------------------------------|--------------|--------------|------------|------------------');
    const sortedFailures = [...failures].sort((a, b) => b.abs_error - a.abs_error);
    for (let i = 0; i < 10 && i < sortedFailures.length; i++) {
      const r = sortedFailures[i];
      console.log(
        `${r.wallet} | $${r.dome_realized.toFixed(2).padStart(10)} | $${r.v11_realized.toFixed(2).padStart(10)} | $${r.abs_error.toFixed(0).padStart(8)} | ${r.failure_reason}`
      );
    }
  }

  // Gap stats summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   GAP STATS SUMMARY');
  console.log('════════════════════════════════════════════════════════════\n');

  const walletsWithGaps = results.filter(r => r.gap_stats && r.gap_stats.unmapped_event_count > 0);
  const totalSkippedEvents = results.reduce((sum, r) => sum + (r.gap_stats?.unmapped_event_count || 0), 0);
  const totalSkippedUsdc = results.reduce((sum, r) => sum + (r.gap_stats?.skipped_usdc_abs || 0), 0);
  const totalSkippedTokens = results.reduce((sum, r) => sum + (r.gap_stats?.skipped_token_abs || 0), 0);
  const uniqueConditions = new Set<string>();
  for (const r of results) {
    if (r.gap_stats?.skipped_conditions_sample) {
      for (const c of r.gap_stats.skipped_conditions_sample) {
        uniqueConditions.add(c);
      }
    }
  }

  console.log(`Wallets with mapping gaps: ${walletsWithGaps.length}/${results.length} (${(walletsWithGaps.length/Math.max(results.length,1)*100).toFixed(1)}%)`);
  console.log(`Total skipped CTF events: ${totalSkippedEvents}`);
  console.log(`Total skipped USDC (est): $${totalSkippedUsdc.toFixed(2)}`);
  console.log(`Total skipped tokens: ${totalSkippedTokens.toFixed(2)}`);
  console.log(`Unique unmapped conditions (sample): ${uniqueConditions.size}`);

  // Show top 5 wallets by skipped USDC
  const sortedBySkipped = [...results]
    .filter(r => r.gap_stats && r.gap_stats.skipped_usdc_abs > 0)
    .sort((a, b) => (b.gap_stats?.skipped_usdc_abs || 0) - (a.gap_stats?.skipped_usdc_abs || 0));

  if (sortedBySkipped.length > 0) {
    console.log('\nTop 5 wallets by skipped USDC:');
    for (let i = 0; i < 5 && i < sortedBySkipped.length; i++) {
      const r = sortedBySkipped[i];
      console.log(`  ${r.wallet.slice(0, 10)}... skipped_usdc=$${r.gap_stats?.skipped_usdc_abs.toFixed(2)}, events=${r.gap_stats?.unmapped_event_count}`);
    }
  }

  // Save results
  const outputSuffix = INCLUDE_SYNTHETIC_REDEMPTIONS ? '' : '_no_synth';
  const outputFile = `tmp/v11_vs_dome_no_transfers_validation${outputSuffix}.json`;
  fs.writeFileSync(outputFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    benchmark_source: 'pm_dome_realized_benchmarks_v1',
    config: {
      includeSyntheticRedemptions: INCLUDE_SYNTHETIC_REDEMPTIONS,
      includeErc1155Transfers: false,
    },
    summary: {
      total_wallets: results.length,
      passed: totalPass,
      pass_rate: totalPass / Math.max(results.length, 1),
      large_wallet_pass_rate: largePassed / Math.max(large.length, 1),
      small_wallet_pass_rate: smallPassed / Math.max(small.length, 1),
      clean_clob_pass_rate: cleanClobPassed / Math.max(cleanClob.length, 1),
      target: 0.90
    },
    gap_stats_summary: {
      wallets_with_gaps: walletsWithGaps.length,
      total_skipped_events: totalSkippedEvents,
      total_skipped_usdc_est: totalSkippedUsdc,
      total_skipped_tokens: totalSkippedTokens,
      unique_unmapped_conditions_sample: uniqueConditions.size,
    },
    results
  }, null, 2));

  console.log(`\n✅ Results saved to ${outputFile}`);

  // Generate clean wallet list for MVP leaderboard
  const mvpWallets = results.filter(r => r.passed && r.is_clean_clob);
  fs.writeFileSync('tmp/mvp_clean_wallets_dome_validated.json', JSON.stringify({
    generated_at: new Date().toISOString(),
    description: 'Transfer-free, CLOB-only wallets validated against Dome realized PnL',
    count: mvpWallets.length,
    wallets: mvpWallets.map(w => ({
      wallet: w.wallet,
      dome_realized: w.dome_realized,
      v11_realized: w.v11_realized,
      abs_error: w.abs_error,
      pct_error: w.pct_error
    }))
  }, null, 2));

  console.log(`📋 MVP clean wallet list saved to tmp/mvp_clean_wallets_dome_validated.json (${mvpWallets.length} wallets)\n`);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
