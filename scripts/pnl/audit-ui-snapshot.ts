#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * AUDIT UI SNAPSHOT
 * ============================================================================
 *
 * Analyzes a UI PnL snapshot and generates an audit report.
 *
 * USAGE:
 *   npx tsx scripts/pnl/audit-ui-snapshot.ts \
 *     --snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json \
 *     --output=docs/reports/UI_SNAPSHOT_AUDIT_2025_12_07.md
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

interface UISnapshot {
  metadata: {
    source: string;
    fetched_at: string;
    total_wallets: number;
    successful: number;
    failed: number;
    nonexistent: number;
  };
  wallets: Array<{
    wallet: string;
    uiPnL: number | null;
    scrapedAt: string;
    success: boolean;
    error?: string;
    retries: number;
    rawText?: string;
  }>;
}

interface AuditResult {
  ok: Array<{ wallet: string; pnl: number }>;
  nonexistent: Array<{ wallet: string; error: string }>;
  error: Array<{ wallet: string; error: string }>;
  outlier: Array<{ wallet: string; pnl: number; reason: string }>;
}

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const [k, v] = a.split('=');
    if (k.startsWith('--')) args.set(k.replace(/^--/, ''), v ?? 'true');
  }
  return {
    snapshot: args.get('snapshot'),
    output: args.get('output'),
  };
}

// ============================================================================
// Audit Logic
// ============================================================================

function auditSnapshot(snapshot: UISnapshot): AuditResult {
  const result: AuditResult = {
    ok: [],
    nonexistent: [],
    error: [],
    outlier: [],
  };

  for (const wallet of snapshot.wallets) {
    if (wallet.success && wallet.uiPnL !== null) {
      result.ok.push({ wallet: wallet.wallet, pnl: wallet.uiPnL });

      // Detect outliers (extremely high/low PnL)
      if (Math.abs(wallet.uiPnL) > 500000) {
        result.outlier.push({
          wallet: wallet.wallet,
          pnl: wallet.uiPnL,
          reason: `Extreme PnL: ${wallet.uiPnL >= 0 ? '+' : ''}${wallet.uiPnL.toLocaleString()}`,
        });
      }
    } else if (wallet.error?.includes('does not exist') || wallet.error?.includes('anon')) {
      result.nonexistent.push({
        wallet: wallet.wallet,
        error: wallet.error || 'Unknown',
      });
    } else {
      result.error.push({
        wallet: wallet.wallet,
        error: wallet.error || 'Unknown error',
      });
    }
  }

  return result;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(snapshot: UISnapshot, audit: AuditResult): string {
  const fetchedAt = new Date(snapshot.metadata.fetched_at).toISOString();
  const dateStr = fetchedAt.split('T')[0];

  const md: string[] = [];

  md.push(`# UI PnL Snapshot Audit`);
  md.push(``);
  md.push(`**Date:** ${dateStr}`);
  md.push(`**Snapshot:** ${snapshot.metadata.source}`);
  md.push(`**Fetched At:** ${fetchedAt}`);
  md.push(`**Status:** ✅ COMPLETE`);
  md.push(``);
  md.push(`---`);
  md.push(``);

  // Summary
  md.push(`## Summary`);
  md.push(``);
  md.push(`| Status | Count | Percentage |`);
  md.push(`|--------|-------|------------|`);
  md.push(`| ✅ OK | ${audit.ok.length} | ${((audit.ok.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}% |`);
  md.push(`| ⚠️  Nonexistent | ${audit.nonexistent.length} | ${((audit.nonexistent.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}% |`);
  md.push(`| ❌ Error | ${audit.error.length} | ${((audit.error.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}% |`);
  md.push(`| 🔍 Outlier | ${audit.outlier.length} | ${((audit.outlier.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}% |`);
  md.push(`| **Total** | **${snapshot.metadata.total_wallets}** | **100.0%** |`);
  md.push(``);

  // OK Wallets
  md.push(`---`);
  md.push(``);
  md.push(`## ✅ OK Wallets (${audit.ok.length})`);
  md.push(``);
  md.push(`Successfully fetched with valid PnL data.`);
  md.push(``);
  md.push(`| Wallet | UI PnL |`);
  md.push(`|--------|--------|`);

  const sortedOk = [...audit.ok].sort((a, b) => b.pnl - a.pnl);
  for (const { wallet, pnl } of sortedOk.slice(0, 10)) {
    const pnlStr = pnl >= 0 ? `+$${pnl.toLocaleString()}` : `-$${Math.abs(pnl).toLocaleString()}`;
    md.push(`| \`${wallet}\` | ${pnlStr} |`);
  }

  if (sortedOk.length > 10) {
    md.push(`| ... | ... |`);
    md.push(`| *${sortedOk.length - 10} more wallets* | |`);
  }

  md.push(``);

  // Nonexistent
  if (audit.nonexistent.length > 0) {
    md.push(`---`);
    md.push(``);
    md.push(`## ⚠️  Nonexistent Wallets (${audit.nonexistent.length})`);
    md.push(``);
    md.push(`These wallets show "anon" + $0 on Polymarket UI, indicating they don't exist or have no activity.`);
    md.push(``);
    md.push(`**Action:** Exclude from validation.`);
    md.push(``);
    md.push(`| Wallet | Error |`);
    md.push(`|--------|-------|`);

    for (const { wallet, error } of audit.nonexistent) {
      md.push(`| \`${wallet}\` | ${error} |`);
    }

    md.push(``);
  }

  // Errors
  if (audit.error.length > 0) {
    md.push(`---`);
    md.push(``);
    md.push(`## ❌ Error Wallets (${audit.error.length})`);
    md.push(``);
    md.push(`These wallets encountered errors during scraping.`);
    md.push(``);
    md.push(`**Action:** Retry or investigate.`);
    md.push(``);
    md.push(`| Wallet | Error |`);
    md.push(`|--------|-------|`);

    for (const { wallet, error } of audit.error) {
      md.push(`| \`${wallet}\` | ${error} |`);
    }

    md.push(``);
  }

  // Outliers
  if (audit.outlier.length > 0) {
    md.push(`---`);
    md.push(``);
    md.push(`## 🔍 Outlier Wallets (${audit.outlier.length})`);
    md.push(``);
    md.push(`Wallets with extreme PnL values (|PnL| > $500,000).`);
    md.push(``);
    md.push(`**Action:** Verify manually or use with caution.`);
    md.push(``);
    md.push(`| Wallet | PnL | Reason |`);
    md.push(`|--------|-----|--------|`);

    const sortedOutliers = [...audit.outlier].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    for (const { wallet, pnl, reason } of sortedOutliers) {
      const pnlStr = pnl >= 0 ? `+$${pnl.toLocaleString()}` : `-$${Math.abs(pnl).toLocaleString()}`;
      md.push(`| \`${wallet}\` | ${pnlStr} | ${reason} |`);
    }

    md.push(``);
  }

  // Recommendations
  md.push(`---`);
  md.push(``);
  md.push(`## Recommendations`);
  md.push(``);

  if (audit.ok.length === snapshot.metadata.total_wallets) {
    md.push(`✅ **All wallets fetched successfully** - snapshot is clean and ready for validation.`);
  } else {
    md.push(`### For Validation Work`);
    md.push(``);
    md.push(`1. **Exclude nonexistent wallets** from validation cohorts`);
    md.push(`2. **Retry error wallets** if critical to your test set`);
    md.push(`3. **Verify outliers manually** before using as truth`);
  }

  md.push(``);
  md.push(`### Next Steps`);
  md.push(``);
  md.push(`1. Load snapshot into \`pm_ui_pnl_benchmarks_v2\` table`);
  md.push(`2. Use OK wallets (${audit.ok.length}) as primary truth set`);
  md.push(`3. Run V29 validation against this cohort`);
  md.push(``);

  // Footer
  md.push(`---`);
  md.push(``);
  md.push(`**Generated:** ${new Date().toISOString()}`);
  md.push(`**Terminal:** Claude 1`);
  md.push(`**Tool:** \`scripts/pnl/audit-ui-snapshot.ts\``);
  md.push(``);

  return md.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  if (!config.snapshot) {
    console.error('❌ ERROR: --snapshot parameter required');
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   AUDIT UI SNAPSHOT`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`📄 Snapshot: ${config.snapshot}`);
  console.log(`📄 Output:   ${config.output || 'auto-generated'}\n`);

  // Load snapshot
  const snapshotPath = path.join(process.cwd(), config.snapshot);
  const raw = await fs.readFile(snapshotPath, 'utf8');
  const snapshot: UISnapshot = JSON.parse(raw);

  console.log(`✅ Loaded ${snapshot.wallets.length} wallets from snapshot\n`);

  // Audit
  console.log(`🔍 Running audit...\n`);
  const audit = auditSnapshot(snapshot);

  // Generate report
  const report = generateReport(snapshot, audit);

  // Save
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');
  const outputPath = config.output || path.join(
    process.cwd(),
    'docs/reports',
    `UI_SNAPSHOT_AUDIT_${dateStr}.md`
  );

  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(outputPath, report);

  // Summary
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`                    AUDIT SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Total wallets:    ${snapshot.metadata.total_wallets}`);
  console.log(`  OK:               ${audit.ok.length} (${((audit.ok.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log(`  Nonexistent:      ${audit.nonexistent.length} (${((audit.nonexistent.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log(`  Error:            ${audit.error.length} (${((audit.error.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log(`  Outlier:          ${audit.outlier.length} (${((audit.outlier.length / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`📄 Report saved to: ${outputPath}`);
  console.log(`\n═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
