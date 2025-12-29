/**
 * Classify Wallet Data Sources
 *
 * Categorizes wallets by their activity pattern:
 * - clob_only: Pure CLOB trading, no CTF operations
 * - mixed_ctf_clob: Uses both CLOB and CTF (deposits/splits/merges)
 * - ctf_heavy: Primarily CTF-based operations
 *
 * This classification helps predict V18/V19 accuracy:
 * - clob_only → V18 should be exact
 * - mixed_ctf_clob → V19 needed for accuracy
 * - ctf_heavy → Special handling may be required
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';
const OUTPUT_FILE = 'data/wallet-classification-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: {
    username: string;
    pnl: number;
    volume: number;
  };
  total_pnl_error_pct: number;
}

interface Report {
  results: BenchmarkResult[];
}

interface WalletClassification {
  wallet: string;
  username: string;
  class: 'clob_only' | 'mixed_ctf_clob' | 'ctf_heavy' | 'unknown';
  clob_trade_count: number;
  clob_volume_usdc: number;
  ctf_event_count: number;
  ctf_position_split_count: number;
  ctf_position_merge_count: number;
  ctf_payout_redemption_count: number;
  ctf_ratio: number; // CTF events / (CLOB trades + CTF events)
  ui_pnl: number;
  v18_error_pct: number;
  diagnosis: string;
}

async function getClobStats(wallet: string): Promise<{ trade_count: number; volume_usdc: number }> {
  const query = `
    WITH deduped AS (
      SELECT event_id, any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT count() as trade_count, sum(usdc) as volume_usdc
    FROM deduped
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return {
    trade_count: rows[0]?.trade_count ? Number(rows[0].trade_count) : 0,
    volume_usdc: rows[0]?.volume_usdc ? Number(rows[0].volume_usdc) : 0,
  };
}

async function getCtfStats(
  wallet: string
): Promise<{ total: number; splits: number; merges: number; redemptions: number }> {
  // Check pm_ctf_events table for CTF operations
  const query = `
    SELECT
      count() as total,
      countIf(event_type = 'PositionSplit') as splits,
      countIf(event_type = 'PositionsMerge') as merges,
      countIf(event_type = 'PayoutRedemption') as redemptions
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    return {
      total: rows[0]?.total ? Number(rows[0].total) : 0,
      splits: rows[0]?.splits ? Number(rows[0].splits) : 0,
      merges: rows[0]?.merges ? Number(rows[0].merges) : 0,
      redemptions: rows[0]?.redemptions ? Number(rows[0].redemptions) : 0,
    };
  } catch {
    // Table might not exist
    return { total: 0, splits: 0, merges: 0, redemptions: 0 };
  }
}

function classifyWallet(
  clobCount: number,
  ctfCount: number
): 'clob_only' | 'mixed_ctf_clob' | 'ctf_heavy' | 'unknown' {
  const total = clobCount + ctfCount;
  if (total === 0) return 'unknown';

  const ctfRatio = ctfCount / total;

  if (ctfCount === 0) return 'clob_only';
  if (ctfRatio > 0.7) return 'ctf_heavy';
  return 'mixed_ctf_clob';
}

function diagnose(classification: string, errorPct: number, ctfSplits: number): string {
  if (classification === 'clob_only' && errorPct <= 1) {
    return 'V18 exact match - pure CLOB wallet';
  }
  if (classification === 'clob_only' && errorPct > 1) {
    return 'CLOB-only but error > 1% - check resolution mapping or data gaps';
  }
  if (classification === 'mixed_ctf_clob' && ctfSplits > 0) {
    return 'CTF PositionSplit deposits - need V19 unified ledger';
  }
  if (classification === 'mixed_ctf_clob') {
    return 'Mixed activity - V19 may improve accuracy';
  }
  if (classification === 'ctf_heavy') {
    return 'CTF-heavy - needs custom handling';
  }
  return 'Unknown pattern';
}

async function main() {
  console.log('='.repeat(80));
  console.log('WALLET DATA SOURCE CLASSIFICATION');
  console.log('='.repeat(80));

  // Load benchmark wallets
  let wallets: { wallet: string; username: string; ui_pnl: number; error_pct: number }[] = [];

  if (fs.existsSync(REPORT_FILE)) {
    const report: Report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
    wallets = report.results.map((r) => ({
      wallet: r.wallet,
      username: r.ui.username,
      ui_pnl: r.ui.pnl,
      error_pct: r.total_pnl_error_pct || 0,
    }));
    console.log(`Loaded ${wallets.length} wallets from benchmark report\n`);
  } else {
    console.log('No benchmark report found. Provide wallets via command line.');
    const wallet = process.argv[2];
    if (wallet) {
      wallets = [{ wallet, username: 'CLI', ui_pnl: 0, error_pct: 0 }];
    }
  }

  const classifications: WalletClassification[] = [];

  console.log('Wallet           | Username     | Class          | CLOB   | CTF    | Ratio  | V18 Err% | Diagnosis');
  console.log('-'.repeat(120));

  for (const w of wallets) {
    const clobStats = await getClobStats(w.wallet);
    const ctfStats = await getCtfStats(w.wallet);

    const classLabel = classifyWallet(clobStats.trade_count, ctfStats.total);
    const ctfRatio = clobStats.trade_count + ctfStats.total > 0
      ? ctfStats.total / (clobStats.trade_count + ctfStats.total)
      : 0;

    const diagnosis = diagnose(classLabel, w.error_pct, ctfStats.splits);

    const classification: WalletClassification = {
      wallet: w.wallet,
      username: w.username,
      class: classLabel,
      clob_trade_count: clobStats.trade_count,
      clob_volume_usdc: clobStats.volume_usdc,
      ctf_event_count: ctfStats.total,
      ctf_position_split_count: ctfStats.splits,
      ctf_position_merge_count: ctfStats.merges,
      ctf_payout_redemption_count: ctfStats.redemptions,
      ctf_ratio: ctfRatio,
      ui_pnl: w.ui_pnl,
      v18_error_pct: w.error_pct,
      diagnosis,
    };

    classifications.push(classification);

    const classStr = classLabel.padEnd(14);
    console.log(
      `${w.wallet.substring(0, 14)}... | ` +
        `${w.username.substring(0, 12).padEnd(12)} | ` +
        `${classStr} | ` +
        `${String(clobStats.trade_count).padStart(6)} | ` +
        `${String(ctfStats.total).padStart(6)} | ` +
        `${(ctfRatio * 100).toFixed(1).padStart(5)}% | ` +
        `${w.error_pct.toFixed(2).padStart(7)}% | ` +
        `${diagnosis.substring(0, 40)}`
    );
  }

  // Summary by class
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY BY CLASS');
  console.log('='.repeat(80));

  const byClass = classifications.reduce(
    (acc, c) => {
      if (!acc[c.class]) {
        acc[c.class] = { count: 0, avg_error: 0, errors: [] as number[] };
      }
      acc[c.class].count++;
      acc[c.class].errors.push(c.v18_error_pct);
      return acc;
    },
    {} as Record<string, { count: number; avg_error: number; errors: number[] }>
  );

  for (const [cls, data] of Object.entries(byClass)) {
    const avgError = data.errors.reduce((a, b) => a + b, 0) / data.errors.length;
    const medianError = data.errors.sort((a, b) => a - b)[Math.floor(data.errors.length / 2)];
    const passCount = data.errors.filter((e) => e <= 1).length;

    console.log(`\n${cls}:`);
    console.log(`  Count:        ${data.count}`);
    console.log(`  Pass (≤1%):   ${passCount}/${data.count} (${((passCount / data.count) * 100).toFixed(0)}%)`);
    console.log(`  Avg Error:    ${avgError.toFixed(2)}%`);
    console.log(`  Median Error: ${medianError.toFixed(2)}%`);
  }

  // Save classification report
  const classificationReport = {
    generated_at: new Date().toISOString(),
    total_wallets: classifications.length,
    summary: Object.fromEntries(
      Object.entries(byClass).map(([cls, data]) => [
        cls,
        {
          count: data.count,
          pass_count: data.errors.filter((e) => e <= 1).length,
          avg_error: data.errors.reduce((a, b) => a + b, 0) / data.errors.length,
          median_error: data.errors.sort((a, b) => a - b)[Math.floor(data.errors.length / 2)],
        },
      ])
    ),
    classifications,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(classificationReport, null, 2));
  console.log(`\nClassification report saved to: ${OUTPUT_FILE}`);

  // Recommendations
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(80));

  const clobOnly = byClass['clob_only'];
  const mixed = byClass['mixed_ctf_clob'];

  if (clobOnly && clobOnly.errors.filter((e) => e <= 1).length === clobOnly.count) {
    console.log('✓ V18.1 is achieving exact match for all CLOB-only wallets');
  } else if (clobOnly) {
    console.log('⚠ Some CLOB-only wallets have >1% error - investigate data gaps');
  }

  if (mixed && mixed.count > 0) {
    console.log(`→ ${mixed.count} wallets need V19 unified ledger for better accuracy`);
    console.log('  Next step: Build V19 engine using pm_unified_ledger_v5');
  }
}

main().catch(console.error);
