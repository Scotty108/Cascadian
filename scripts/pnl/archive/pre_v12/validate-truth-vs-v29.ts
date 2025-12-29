#!/usr/bin/env npx tsx
/**
 * Validate CLOB-Only Truth Dataset vs V29 Engine
 *
 * Runs V29 against all wallets in the truth dataset and prints:
 * - UI parity metrics (within $1/$5/$10, within 1%/2%)
 * - Classifier agreement (V29 classification matches CLOB_ONLY)
 * - DB-CLEAN accuracy (using database-first, non-circular cleanliness rules)
 * - All-data accuracy
 * - Outlier breakdown with DB-based tags
 *
 * IMPORTANT: "Clean data" is defined by DATABASE rules, not UI mismatch.
 * This prevents circular validation logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@clickhouse/client';
import { classifyClobCleanlinessDb, type DbCleanlinessTag, type DbCleanlinessResult, type CleanlinessTier } from '../../lib/pnl/clobCleanlinessDbRules';

interface TruthWallet {
  wallet: string;
  uiPnl: number;
  gain: number;
  loss: number;
  volume: number;
  identityCheckPass: boolean;
  clobEvents: number;
  openPositionsApprox: number;
  cashFlowEstimate: number;
}

interface TruthDataset {
  metadata: {
    wallet_count: number;
    identity_pass_count: number;
  };
  wallets: TruthWallet[];
}

interface V29Result {
  wallet: string;
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  clob_events: number;
  redemption_events: number;
  split_events: number;
  merge_events: number;
}

interface Comparison {
  wallet: string;
  uiPnl: number;
  v29Pnl: number;
  absError: number;
  pctError: number;
  classifierPass: boolean;
  // DB-based cleanliness (non-circular)
  dbCleanliness: DbCleanlinessResult;
}

const TRUTH_PATH = path.join(process.cwd(), 'data/regression/clob_only_truth_v1.json');
const V29_SIDECAR_PATH = path.join(process.cwd(), 'tmp/v29_truth_join.json');

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function runV29ForWallet(wallet: string): Promise<V29Result | null> {
  // V29 query - realized PnL from cash flow + redemption payout
  // Schema: source_type (CLOB, PayoutRedemption, PositionSplit, PositionsMerge)
  //         wallet_address, condition_id, outcome_index, usdc_delta, token_delta, payout_norm
  const query = `
    SELECT
      {wallet:String} as wallet,
      -- Total PnL: sum of cash flow + (net_shares * resolution_price) for resolved positions
      sum(
        CASE
          WHEN payout_norm IS NOT NULL AND payout_norm >= 0
          THEN usdc_delta + (token_delta * payout_norm)
          ELSE usdc_delta  -- Unresolved positions: just cash flow contribution
        END
      ) as total_pnl,
      -- Realized PnL: only from resolved positions
      sum(
        CASE
          WHEN payout_norm IS NOT NULL AND payout_norm >= 0
          THEN usdc_delta + (token_delta * payout_norm)
          ELSE 0
        END
      ) as realized_pnl,
      -- Unrealized: placeholder (would need current prices)
      0.0 as unrealized_pnl,
      -- Event counts for classification
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events,
      countIf(source_type = 'PositionSplit') as split_events,
      countIf(source_type = 'PositionsMerge') as merge_events
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address = {wallet:String}
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow'
    });
    const rows = await result.json<V29Result>();
    return rows[0] || null;
  } catch (error) {
    console.error(`Error querying V29 for ${wallet}:`, error);
    return null;
  }
}

function classifyWallet(v29: V29Result): 'CLOB_ONLY' | 'AMM_MIXED' | 'UNKNOWN' {
  const hasSplitMerge = v29.split_events > 0 || v29.merge_events > 0;
  if (hasSplitMerge) return 'AMM_MIXED';
  if (v29.clob_events > 0) return 'CLOB_ONLY';
  return 'UNKNOWN';
}

function summarizeDbTags(comparisons: Comparison[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const c of comparisons) {
    for (const tag of c.dbCleanliness.tags) {
      summary[tag] = (summary[tag] || 0) + 1;
    }
  }
  return summary;
}

function summarizeTiers(comparisons: Comparison[]): Record<CleanlinessTier, number> {
  const summary: Record<CleanlinessTier, number> = {
    'TIER_A_PRISTINE': 0,
    'TIER_B_USABLE': 0,
    'TIER_C_DATA_GAP': 0,
  };
  for (const c of comparisons) {
    summary[c.dbCleanliness.tier]++;
  }
  return summary;
}

function formatDashboard(
  comparisons: Comparison[],
  identityPassCount: number,
  totalWallets: number
): string {
  const lines: string[] = [];

  const highPnlCount = comparisons.filter(c => Math.abs(c.uiPnl) >= 500).length;
  const classifierPassCount = comparisons.filter(c => c.classifierPass).length;

  // Tiered cleanliness (database-first, non-circular definition)
  const tierA = comparisons.filter(c => c.dbCleanliness.tier === 'TIER_A_PRISTINE');
  const tierB = comparisons.filter(c => c.dbCleanliness.tier === 'TIER_B_USABLE');
  const tierC = comparisons.filter(c => c.dbCleanliness.tier === 'TIER_C_DATA_GAP');
  const usableWallets = comparisons.filter(c => c.dbCleanliness.isUsableForLeaderboard);

  // Accuracy metrics (all data)
  const within1 = comparisons.filter(c => c.absError <= 1).length;
  const within5 = comparisons.filter(c => c.absError <= 5).length;
  const within10 = comparisons.filter(c => c.absError <= 10).length;
  const within50 = comparisons.filter(c => c.absError <= 50).length;
  const within100 = comparisons.filter(c => c.absError <= 100).length;

  const within1pct = comparisons.filter(c => c.pctError <= 1).length;
  const within2pct = comparisons.filter(c => c.pctError <= 2).length;
  const within5pct = comparisons.filter(c => c.pctError <= 5).length;
  const within10pct = comparisons.filter(c => c.pctError <= 10).length;

  // Usable wallets accuracy (Tier A + Tier B)
  const usableWithin1pct = usableWallets.filter(c => c.pctError <= 1).length;
  const usableWithin2pct = usableWallets.filter(c => c.pctError <= 2).length;
  const usableWithin5pct = usableWallets.filter(c => c.pctError <= 5).length;
  const usableWithin10pct = usableWallets.filter(c => c.pctError <= 10).length;

  // Tier A only accuracy (pristine data)
  const tierAWithin1pct = tierA.filter(c => c.pctError <= 1).length;
  const tierAWithin5pct = tierA.filter(c => c.pctError <= 5).length;

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════');
  lines.push('  CLOB-ONLY V29 vs UI ACCURACY DASHBOARD (DB-FIRST TIERED CLEANLINESS)');
  lines.push('═══════════════════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('  DATASET:');
  lines.push(`    Total wallets:        ${totalWallets}`);
  lines.push(`    Identity check pass:  ${identityPassCount}/${totalWallets} (${(identityPassCount/totalWallets*100).toFixed(1)}%)`);
  lines.push(`    |PnL| >= $500:        ${highPnlCount}`);
  lines.push('');
  lines.push('  DB-BASED CLEANLINESS TIERS (non-circular, database-only rules):');
  lines.push(`    TIER_A_PRISTINE:      ${tierA.length}/${comparisons.length} (${(tierA.length/comparisons.length*100).toFixed(1)}%) - No data issues`);
  lines.push(`    TIER_B_USABLE:        ${tierB.length}/${comparisons.length} (${(tierB.length/comparisons.length*100).toFixed(1)}%) - Minor issues, still accurate`);
  lines.push(`    TIER_C_DATA_GAP:      ${tierC.length}/${comparisons.length} (${(tierC.length/comparisons.length*100).toFixed(1)}%) - Significant data gaps`);
  lines.push(`    ─────────────────────`);
  lines.push(`    Usable (A+B):         ${usableWallets.length}/${comparisons.length} (${(usableWallets.length/comparisons.length*100).toFixed(1)}%) ← Use for leaderboard`);
  lines.push('');
  lines.push('  CLASSIFIER AGREEMENT (V29 badge === CLOB_ONLY):');
  lines.push(`    Pass rate:            ${classifierPassCount}/${comparisons.length} (${(classifierPassCount/comparisons.length*100).toFixed(1)}%)`);
  lines.push('');
  lines.push('  ═══════════════════════════════════════════════════════════════');
  lines.push('  UI PARITY - USABLE WALLETS (Tier A + B) - PRIMARY METRIC');
  lines.push('  ═══════════════════════════════════════════════════════════════');
  if (usableWallets.length > 0) {
    lines.push(`    Within 1%:            ${usableWithin1pct}/${usableWallets.length} (${(usableWithin1pct/usableWallets.length*100).toFixed(1)}%)`);
    lines.push(`    Within 2%:            ${usableWithin2pct}/${usableWallets.length} (${(usableWithin2pct/usableWallets.length*100).toFixed(1)}%)`);
    lines.push(`    Within 5%:            ${usableWithin5pct}/${usableWallets.length} (${(usableWithin5pct/usableWallets.length*100).toFixed(1)}%)`);
    lines.push(`    Within 10%:           ${usableWithin10pct}/${usableWallets.length} (${(usableWithin10pct/usableWallets.length*100).toFixed(1)}%)`);
  } else {
    lines.push('    (No usable wallets found)');
  }
  if (tierA.length > 0) {
    lines.push('');
    lines.push('  UI PARITY - TIER A PRISTINE ONLY:');
    lines.push(`    Within 1%:            ${tierAWithin1pct}/${tierA.length} (${(tierAWithin1pct/tierA.length*100).toFixed(1)}%)`);
    lines.push(`    Within 5%:            ${tierAWithin5pct}/${tierA.length} (${(tierAWithin5pct/tierA.length*100).toFixed(1)}%)`);
  }
  lines.push('');
  lines.push('  UI PARITY - ALL DATA (Absolute Error):');
  lines.push(`    Within $1:            ${within1}/${comparisons.length} (${(within1/comparisons.length*100).toFixed(1)}%)`);
  lines.push(`    Within $5:            ${within5}/${comparisons.length} (${(within5/comparisons.length*100).toFixed(1)}%)`);
  lines.push(`    Within $10:           ${within10}/${comparisons.length} (${(within10/comparisons.length*100).toFixed(1)}%)`);
  lines.push(`    Within $50:           ${within50}/${comparisons.length} (${(within50/comparisons.length*100).toFixed(1)}%)`);
  lines.push(`    Within $100:          ${within100}/${comparisons.length} (${(within100/comparisons.length*100).toFixed(1)}%)`);
  lines.push('');
  lines.push('  UI PARITY - ALL DATA (Percentage Error):');
  lines.push(`    Within 1%:            ${within1pct}/${comparisons.length} (${(within1pct/comparisons.length*100).toFixed(1)}%)`);
  lines.push(`    Within 2%:            ${within2pct}/${comparisons.length} (${(within2pct/comparisons.length*100).toFixed(1)}%)`);
  lines.push(`    Within 5%:            ${within5pct}/${comparisons.length} (${(within5pct/comparisons.length*100).toFixed(1)}%)`);
  lines.push(`    Within 10%:           ${within10pct}/${comparisons.length} (${(within10pct/comparisons.length*100).toFixed(1)}%)`);

  // DB Tag breakdown
  const tagSummary = summarizeDbTags(comparisons);
  lines.push('');
  lines.push('  DB CLEANLINESS TAG BREAKDOWN:');
  for (const [tag, count] of Object.entries(tagSummary).sort((a, b) => b[1] - a[1])) {
    const pct = (count / comparisons.length * 100).toFixed(1);
    lines.push(`    ${tag.padEnd(50)} ${count.toString().padStart(3)} (${pct}%)`);
  }

  // Worst offenders among usable wallets (if they have errors, it's an engine issue)
  const usableWithErrors = usableWallets.filter(c => c.pctError > 5);
  if (usableWithErrors.length > 0) {
    lines.push('');
    lines.push('  ⚠️  USABLE WALLETS WITH >5% ERROR (investigate engine/formula):');
    const sorted = [...usableWithErrors].sort((a, b) => b.pctError - a.pctError);
    for (const w of sorted.slice(0, 5)) {
      const sign = w.v29Pnl >= w.uiPnl ? '+' : '';
      lines.push(`    ${w.wallet.slice(0, 10)}...  UI: $${w.uiPnl.toFixed(2).padStart(10)}  V29: $${w.v29Pnl.toFixed(2).padStart(10)}  Err: ${sign}$${(w.v29Pnl - w.uiPnl).toFixed(2)} (${w.pctError.toFixed(1)}%) [${w.dbCleanliness.tier}]`);
    }
  }

  // Tier C wallets (data gap wallets - expected to have errors)
  if (tierC.length > 0) {
    lines.push('');
    lines.push('  TIER_C_DATA_GAP WALLETS (excluded from leaderboard):');
    const sorted = [...tierC].sort((a, b) => b.absError - a.absError);
    for (const w of sorted.slice(0, 5)) {
      const tags = w.dbCleanliness.tags.join(', ');
      lines.push(`    ${w.wallet.slice(0, 10)}...  UI: $${w.uiPnl.toFixed(2).padStart(10)}  V29: $${w.v29Pnl.toFixed(2).padStart(10)}  [${tags}]`);
    }
  }

  // Coverage confidence interpretation
  lines.push('');
  lines.push('  COVERAGE CONFIDENCE:');
  const allCoverageScore = (within5pct / comparisons.length) * 100;
  const usableCoverageScore = usableWallets.length > 0 ? (usableWithin5pct / usableWallets.length) * 100 : 0;
  const tierACoverageScore = tierA.length > 0 ? (tierAWithin5pct / tierA.length) * 100 : 0;

  if (tierA.length > 0) {
    if (tierACoverageScore >= 95) {
      lines.push(`    ✅ TIER A PRISTINE: ${tierACoverageScore.toFixed(1)}% within 5% - EXCELLENT`);
    } else {
      lines.push(`    ⚠️  TIER A PRISTINE: ${tierACoverageScore.toFixed(1)}% within 5% - Investigate engine`);
    }
  }

  if (usableCoverageScore >= 95) {
    lines.push(`    ✅ USABLE (A+B): ${usableCoverageScore.toFixed(1)}% within 5% - EXCELLENT (use for leaderboard)`);
  } else if (usableCoverageScore >= 90) {
    lines.push(`    ✅ USABLE (A+B): ${usableCoverageScore.toFixed(1)}% within 5% - GOOD`);
  } else if (usableCoverageScore >= 80) {
    lines.push(`    ⚠️  USABLE (A+B): ${usableCoverageScore.toFixed(1)}% within 5% - MODERATE (investigate)`);
  } else {
    lines.push(`    ❌ USABLE (A+B): ${usableCoverageScore.toFixed(1)}% within 5% - LOW (engine issues likely)`);
  }

  if (allCoverageScore >= 90) {
    lines.push(`    ✅ ALL DATA: ${allCoverageScore.toFixed(1)}% within 5% - Near production ready`);
  } else if (allCoverageScore >= 80) {
    lines.push(`    ⚠️  ALL DATA: ${allCoverageScore.toFixed(1)}% within 5% - Data gaps exist (expected)`);
  } else {
    lines.push(`    ❌ ALL DATA: ${allCoverageScore.toFixed(1)}% within 5% - Significant data gaps`);
  }

  lines.push('');
  lines.push('  NOTE: "Clean data" tiers are defined by DATABASE rules (inventory, coverage,');
  lines.push('        event density) - NOT by UI mismatch. This prevents circular logic.');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

async function main() {
  // Load truth dataset
  if (!fs.existsSync(TRUTH_PATH)) {
    console.error('Truth dataset not found:', TRUTH_PATH);
    process.exit(1);
  }

  const truthData: TruthDataset = JSON.parse(fs.readFileSync(TRUTH_PATH, 'utf-8'));
  const wallets = truthData.wallets;

  console.log(`\nLoaded ${wallets.length} wallets from truth dataset`);
  console.log('Running V29 engine + DB cleanliness classification against each wallet...\n');

  const comparisons: Comparison[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    process.stdout.write(`  [${i + 1}/${wallets.length}] ${w.wallet.slice(0, 10)}... `);

    const v29Result = await runV29ForWallet(w.wallet);
    const dbCleanliness = await classifyClobCleanlinessDb(w.wallet);

    if (v29Result) {
      const classification = classifyWallet(v29Result);
      const classifierPass = classification === 'CLOB_ONLY';
      const absError = Math.abs(v29Result.total_pnl - w.uiPnl);
      const pctError = w.uiPnl !== 0
        ? Math.abs((v29Result.total_pnl - w.uiPnl) / w.uiPnl) * 100
        : (v29Result.total_pnl === 0 ? 0 : 100);

      comparisons.push({
        wallet: w.wallet,
        uiPnl: w.uiPnl,
        v29Pnl: v29Result.total_pnl,
        absError,
        pctError,
        classifierPass,
        dbCleanliness
      });

      const status = absError <= 10 ? '✓' : pctError <= 5 ? '~' : '✗';
      const tierShort = dbCleanliness.tier === 'TIER_A_PRISTINE' ? 'A' : dbCleanliness.tier === 'TIER_B_USABLE' ? 'B' : 'C';
      console.log(`UI: $${w.uiPnl.toFixed(2).padStart(10)}  V29: $${v29Result.total_pnl.toFixed(2).padStart(10)}  Err: $${absError.toFixed(2).padStart(8)} ${status} [${tierShort}]`);
    } else {
      console.log('FAILED to query');
    }
  }

  // Save sidecar file with full diagnostics
  const sidecarData = {
    generated_at: new Date().toISOString(),
    methodology: 'DB-first tiered cleanliness (non-circular)',
    summary: {
      total: comparisons.length,
      tierA: comparisons.filter(c => c.dbCleanliness.tier === 'TIER_A_PRISTINE').length,
      tierB: comparisons.filter(c => c.dbCleanliness.tier === 'TIER_B_USABLE').length,
      tierC: comparisons.filter(c => c.dbCleanliness.tier === 'TIER_C_DATA_GAP').length,
      usable: comparisons.filter(c => c.dbCleanliness.isUsableForLeaderboard).length,
    },
    comparisons: comparisons.map(c => ({
      wallet: c.wallet,
      uiPnl: c.uiPnl,
      v29Pnl: c.v29Pnl,
      absError: c.absError,
      pctError: c.pctError,
      classifierPass: c.classifierPass,
      tier: c.dbCleanliness.tier,
      isUsable: c.dbCleanliness.isUsableForLeaderboard,
      dbTags: c.dbCleanliness.tags,
      dbDiagnostics: c.dbCleanliness.diagnostics
    }))
  };
  fs.writeFileSync(V29_SIDECAR_PATH, JSON.stringify(sidecarData, null, 2));
  console.log(`\nSaved V29 comparison data to ${V29_SIDECAR_PATH}`);

  // Print dashboard
  console.log(formatDashboard(
    comparisons,
    truthData.metadata.identity_pass_count,
    truthData.metadata.wallet_count
  ));

  await clickhouse.close();
}

main().catch(console.error);
