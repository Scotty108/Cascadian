#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * CANONICAL TABLE USAGE AUDIT
 * ============================================================================
 *
 * Scans lib/pnl/ and scripts/pnl/ for hardcoded table names that should
 * be imported from canonicalTables.ts instead.
 *
 * Usage:
 *   npx tsx scripts/pnl/audit-canonical-usage.ts          # Full audit
 *   npx tsx scripts/pnl/audit-canonical-usage.ts --fix    # Show fix suggestions
 *   npx tsx scripts/pnl/audit-canonical-usage.ts --ci     # CI mode (active code only)
 *
 * Exit codes:
 *   0 = No violations (or all violations in archive scope in CI mode)
 *   1 = Violations found in active code
 *
 * CI Mode (--ci):
 *   Only fails if violations exist OUTSIDE lib/pnl/archive/ or deprecated engines.
 *   Deprecated engines: uiActivityEngine*, shadowLedger*, inventoryEngine*, etc.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

// ============================================================================
// PATTERNS TO CHECK
// ============================================================================

/**
 * Hardcoded table names that should use imports instead.
 * Format: [pattern, canonical_import, description]
 */
const HARDCODED_PATTERNS: [RegExp, string, string][] = [
  // Deprecated ledger versions
  [/pm_unified_ledger_v4/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_FULL', 'Use V8 ledger via import'],
  [/pm_unified_ledger_v5/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_FULL', 'Use V8 ledger via import'],
  [/pm_unified_ledger_v6/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_FULL', 'Use V8 ledger via import'],
  [/pm_unified_ledger_v7/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_FULL', 'Use V8 ledger via import'],

  // V8/V9 hardcoded (should use constants)
  [/['"]pm_unified_ledger_v8_tbl['"]/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_FULL', 'Import from canonicalTables'],
  [/['"]pm_unified_ledger_v9_clob_tbl['"]/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_CLOB', 'Import from canonicalTables'],

  // V9 experimental variants
  [/pm_unified_ledger_v9_clob_clean/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_CLOB', 'Deprecated - use canonical CLOB'],
  [/pm_unified_ledger_v9_clob_from_v2/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_CLOB', 'Deprecated - use canonical CLOB'],
  [/pm_unified_ledger_v9_clob_nodrop/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_CLOB', 'Deprecated - use canonical CLOB'],

  // Old PnL tables
  [/pm_cascadian_pnl_v1/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_FULL', 'Deprecated PnL table'],
  [/pm_cascadian_pnl_v2/g, 'CANONICAL_TABLES.UNIFIED_LEDGER_FULL', 'Deprecated PnL table'],

  // Old token maps
  [/pm_token_to_condition_map_v3/g, 'CANONICAL_TABLES.TOKEN_MAP', 'Use V5 token map'],
  [/pm_token_to_condition_map_v4/g, 'CANONICAL_TABLES.TOKEN_MAP', 'Use V5 token map'],

  // Hardcoded canonical tables (should still use imports)
  [/['"]pm_trader_events_v2['"]/g, 'CANONICAL_TABLES.TRADER_EVENTS', 'Import from canonicalTables'],
  [/['"]pm_token_to_condition_map_v5['"]/g, 'CANONICAL_TABLES.TOKEN_MAP', 'Import from canonicalTables'],
  [/['"]pm_condition_resolutions['"]/g, 'CANONICAL_TABLES.RESOLUTIONS', 'Import from canonicalTables'],
];

/**
 * Files to exclude from audit (constants files, this file, etc.)
 */
const EXCLUDED_FILES = [
  'canonicalTables.ts',
  'dataSourceConstants.ts',
  'audit-canonical-usage.ts',
  '.spec.ts',
  '.test.ts',
];

/**
 * Files/patterns considered "archive scope" - violations here don't fail CI.
 * These are deprecated engines scheduled for removal.
 *
 * The production V12 engine (realizedPnlV12.ts) is NOT in archive scope.
 */
const ARCHIVE_SCOPE_PATTERNS = [
  // Deprecated engines (lib/pnl/)
  /uiActivityEngine/,
  /uiPnlEngine/,
  /shadowLedger/,
  /inventoryEngine/,
  /goldenEngine/,
  /hybridEngine/,
  /ctfSidecarEngine/,
  /v23cBatchLoaders/,
  /computeUiPnl/,
  /pnlDisplayLayer/,
  /staticPositionAnalysis/,
  /walletClassifier/,
  /getWalletPnl/,
  /getWalletConfidence/,
  // Archive directories
  /\/archive\//,
  // scripts/pnl/ - most are deprecated or one-off
  // Only keep: realizedPnlV12 paths and audit script clean
  /scripts\/pnl\//,
];

/**
 * Check if a file is in "archive scope" (violations don't fail CI)
 */
function isArchiveScope(filePath: string): boolean {
  return ARCHIVE_SCOPE_PATTERNS.some(pattern => pattern.test(filePath));
}

// ============================================================================
// AUDIT LOGIC
// ============================================================================

interface Violation {
  file: string;
  line: number;
  column: number;
  pattern: string;
  replacement: string;
  description: string;
  lineContent: string;
}

async function auditFile(filePath: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Check each pattern
  for (const [pattern, replacement, description] of HARDCODED_PATTERNS) {
    lines.forEach((line, lineIdx) => {
      // Reset regex state
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        violations.push({
          file: filePath,
          line: lineIdx + 1,
          column: match.index + 1,
          pattern: match[0],
          replacement,
          description,
          lineContent: line.trim(),
        });
      }
    });
  }

  return violations;
}

async function main() {
  const showFix = process.argv.includes('--fix');
  const ciMode = process.argv.includes('--ci');

  console.log('═'.repeat(80));
  console.log('CANONICAL TABLE USAGE AUDIT');
  if (ciMode) {
    console.log('Mode: CI (active code only)');
  }
  console.log('═'.repeat(80));
  console.log();

  // Find all TypeScript files in lib/pnl and scripts/pnl
  const libFiles = await glob('lib/pnl/**/*.ts', { cwd: process.cwd() });
  const scriptFiles = await glob('scripts/pnl/**/*.ts', { cwd: process.cwd() });
  const allFiles = [...libFiles, ...scriptFiles];

  // Filter out excluded files
  const filesToAudit = allFiles.filter(f =>
    !EXCLUDED_FILES.some(excluded => f.includes(excluded))
  );

  console.log(`Scanning ${filesToAudit.length} files...\n`);

  // Collect all violations
  const allViolations: Violation[] = [];

  for (const file of filesToAudit) {
    const violations = await auditFile(file);
    allViolations.push(...violations);
  }

  // Group by file
  const violationsByFile = new Map<string, Violation[]>();
  for (const v of allViolations) {
    const existing = violationsByFile.get(v.file) || [];
    existing.push(v);
    violationsByFile.set(v.file, existing);
  }

  // Separate active vs archive violations for CI mode
  const activeViolations = allViolations.filter(v => !isArchiveScope(v.file));
  const archiveViolations = allViolations.filter(v => isArchiveScope(v.file));

  // Report results
  if (allViolations.length === 0) {
    console.log('✅ No violations found!\n');
    console.log('All files use canonical imports correctly.');
    process.exit(0);
  }

  if (ciMode && activeViolations.length === 0) {
    console.log(`✅ CI PASS: ${allViolations.length} violations found, but ALL are in archive scope.\n`);
    console.log(`   Archive scope: ${archiveViolations.length} violations`);
    console.log('   Active code: 0 violations');
    console.log('\nActive code uses canonical imports correctly.');
    process.exit(0);
  }

  console.log(`❌ Found ${allViolations.length} violations in ${violationsByFile.size} files:\n`);
  if (ciMode) {
    console.log(`   Active code: ${activeViolations.length} violations (MUST FIX)`);
    console.log(`   Archive scope: ${archiveViolations.length} violations (OK to defer)`);
    console.log();
  }

  for (const [file, violations] of violationsByFile) {
    console.log(`\n📄 ${file}`);
    console.log('-'.repeat(70));

    for (const v of violations) {
      console.log(`  Line ${v.line}: ${v.pattern}`);
      console.log(`    → ${v.description}`);
      if (showFix) {
        console.log(`    Fix: Replace with ${v.replacement}`);
      }
      console.log(`    Context: ${v.lineContent.substring(0, 60)}...`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total violations: ${allViolations.length}`);
  console.log(`Files affected: ${violationsByFile.size}`);
  console.log();

  // Categorize violations
  const deprecatedCount = allViolations.filter(v => v.description.includes('Deprecated')).length;
  const hardcodedCount = allViolations.filter(v => v.description.includes('Import')).length;

  console.log('Breakdown:');
  console.log(`  - Deprecated tables: ${deprecatedCount}`);
  console.log(`  - Hardcoded canonicals: ${hardcodedCount}`);

  if (!showFix) {
    console.log('\nRun with --fix to see replacement suggestions.');
  }

  // Write report to file
  const reportPath = 'docs/reports/CANONICAL_TABLE_AUDIT_2025_12_09.md';
  const reportContent = generateMarkdownReport(violationsByFile, allViolations);
  fs.writeFileSync(reportPath, reportContent);
  console.log(`\nReport saved to: ${reportPath}`);

  process.exit(1);
}

function generateMarkdownReport(
  violationsByFile: Map<string, Violation[]>,
  allViolations: Violation[]
): string {
  const lines: string[] = [
    '# Canonical Table Usage Audit Report',
    '',
    `> **Generated:** ${new Date().toISOString()}`,
    `> **Total violations:** ${allViolations.length}`,
    `> **Files affected:** ${violationsByFile.size}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    '| Category | Count |',
    '|----------|-------|',
    `| Deprecated tables | ${allViolations.filter(v => v.description.includes('Deprecated')).length} |`,
    `| Hardcoded canonicals | ${allViolations.filter(v => v.description.includes('Import')).length} |`,
    '',
    '---',
    '',
    '## Violations by File',
    '',
  ];

  for (const [file, violations] of violationsByFile) {
    lines.push(`### ${file}`);
    lines.push('');
    lines.push('| Line | Pattern | Fix |');
    lines.push('|------|---------|-----|');

    for (const v of violations) {
      lines.push(`| ${v.line} | \`${v.pattern}\` | ${v.replacement} |`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## How to Fix');
  lines.push('');
  lines.push('1. Add import at top of file:');
  lines.push('```typescript');
  lines.push("import { CANONICAL_TABLES } from '@/lib/pnl/canonicalTables';");
  lines.push('```');
  lines.push('');
  lines.push('2. Replace hardcoded table names with constants:');
  lines.push('```typescript');
  lines.push("// Before");
  lines.push("const query = `SELECT * FROM pm_unified_ledger_v8_tbl ...`;");
  lines.push('');
  lines.push("// After");
  lines.push("const query = `SELECT * FROM ${CANONICAL_TABLES.UNIFIED_LEDGER_FULL} ...`;");
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Generated by scripts/pnl/audit-canonical-usage.ts*');

  return lines.join('\n');
}

main().catch(console.error);
