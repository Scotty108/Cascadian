#!/usr/bin/env npx tsx
/**
 * Phase 2 Repository Cleanup - Direct Approach
 * Categorizes and moves root MD files based on filename patterns
 */

import { readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

// Get all MD files in root
const rootFiles = readdirSync('.')
  .filter(f => f.endsWith('.md') && statSync(f).isFile());

console.log(`\n📊 Found ${rootFiles.length} MD files in root`);

// Files to keep in root
const keepInRoot = [
  'README.md',
  'CLAUDE.md',
  'RULES.md',
  'CHANGELOG.md',
  'LICENSE.md',
  'mindset.md',
  'rules.md',
  'Article.md'
];

// Categorization function
function categorizeFile(filename: string): string {
  // Keep in root
  if (keepInRoot.includes(filename)) return 'ROOT';

  // Canonical/Quick Start guides
  if (filename.includes('QUICK_START') || filename.includes('QUICK_REF')) {
    if (filename.includes('DATABASE') || filename.includes('CLICKHOUSE')) return 'docs/systems/database';
    if (filename.includes('PNL') || filename.includes('P_L')) return 'docs/systems/pnl';
    if (filename.includes('PIPELINE')) return 'docs/systems/data-pipeline';
    if (filename.includes('POLYMARKET') || filename.includes('API')) return 'docs/systems/polymarket';
    if (filename.includes('BACKFILL')) return 'docs/operations/runbooks';
    if (filename.includes('ERC1155') || filename.includes('BLOCKCHAIN')) return 'docs/systems/data-pipeline';
    return 'docs/reference';
  }

  // Architecture docs
  if (filename.includes('ARCHITECTURE') || filename.includes('SCHEMA')) {
    if (filename.includes('DATABASE') || filename.includes('CLICKHOUSE')) return 'docs/systems/database';
    return 'docs/architecture';
  }

  // Operational guides
  if (filename.includes('OPERATIONAL') || filename.includes('GUIDE') && !filename.includes('INVESTIGATION')) {
    return 'docs/operations';
  }

  // PNL investigations
  if (filename.includes('PNL') || filename.includes('P_L')) {
    if (filename.includes('FINAL') || filename.includes('COMPLETE') || filename.includes('SUMMARY')) {
      return 'docs/archive/duplicates/pnl';
    }
    return 'docs/archive/investigations/pnl';
  }

  // Database investigations
  if (filename.includes('DATABASE') || filename.includes('CLICKHOUSE')) {
    if (filename.includes('FINAL') || filename.includes('COMPLETE') || filename.includes('SUMMARY')) {
      return 'docs/archive/duplicates/database';
    }
    return 'docs/archive/investigations/database';
  }

  // Resolution investigations
  if (filename.includes('RESOLUTION') || filename.includes('COVERAGE')) {
    if (filename.includes('FINAL') || filename.includes('COMPLETE') || filename.includes('SUMMARY')) {
      return 'docs/archive/duplicates/resolution';
    }
    return 'docs/archive/investigations/resolution';
  }

  // API investigations
  if (filename.includes('API') || filename.includes('POLYMARKET')) {
    if (filename.includes('FINAL') || filename.includes('COMPLETE') || filename.includes('SUMMARY')) {
      return 'docs/archive/duplicates/api';
    }
    return 'docs/archive/investigations/api';
  }

  // Backfill investigations
  if (filename.includes('BACKFILL') || filename.includes('PIPELINE')) {
    if (filename.includes('FINAL') || filename.includes('COMPLETE') || filename.includes('SUMMARY')) {
      return 'docs/archive/duplicates/backfill';
    }
    return 'docs/archive/investigations/backfill';
  }

  // Blockchain/ERC1155
  if (filename.includes('ERC1155') || filename.includes('BLOCKCHAIN') || filename.includes('GOLDSKY')) {
    return 'docs/archive/investigations/blockchain';
  }

  // Wallet investigations
  if (filename.includes('WALLET') || filename.includes('HolyMoses') || filename.includes('holymoses') || filename.includes('niggemon')) {
    return 'docs/archive/investigations/wallet';
  }

  // Market investigations
  if (filename.includes('MARKET') || filename.includes('CONDITION_ID')) {
    return 'docs/archive/investigations/market';
  }

  // Mapping/Schema investigations
  if (filename.includes('MAPPING') || filename.includes('SCHEMA')) {
    return 'docs/archive/investigations/database';
  }

  // Phase/Status reports
  if (filename.includes('PHASE') || filename.includes('STATUS') || filename.includes('SESSION')) {
    return 'docs/archive/historical-status';
  }

  // Investigation/Analysis docs
  if (filename.includes('INVESTIGATION') || filename.includes('ANALYSIS') || filename.includes('REPORT')) {
    return 'docs/archive/investigations';
  }

  // Final/Complete/Summary docs
  if (filename.includes('FINAL') || filename.includes('COMPLETE') || filename.includes('SUMMARY') || filename.includes('EXECUTIVE')) {
    return 'docs/archive/duplicates';
  }

  // Default: general investigations
  return 'docs/archive/investigations';
}

// Group files by destination
const byDestination = new Map<string, string[]>();
rootFiles.forEach(file => {
  const dest = categorizeFile(file);
  if (!byDestination.has(dest)) byDestination.set(dest, []);
  byDestination.get(dest)!.push(file);
});

console.log(`\n📦 Move Plan:`);
byDestination.forEach((files, dest) => {
  console.log(`${dest}: ${files.length} files`);
});

// Create all necessary folders
const destinations = Array.from(byDestination.keys()).filter(d => d !== 'ROOT');
destinations.forEach(dest => {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    console.log(`✅ Created: ${dest}`);
  }
});

// Execute moves
console.log(`\n🚀 Executing moves...`);
let movedCount = 0;
let skippedCount = 0;
let errorCount = 0;

byDestination.forEach((files, dest) => {
  if (dest === 'ROOT') {
    console.log(`\n⏭️  Keeping ${files.length} files in root`);
    skippedCount += files.length;
    return;
  }

  console.log(`\n📁 ${dest} (${files.length} files)`);
  files.forEach(file => {
    try {
      const targetPath = join(dest, file);
      execSync(`mv "${file}" "${targetPath}"`, { stdio: 'pipe' });
      movedCount++;
      if (files.length <= 10) console.log(`   ✅ ${file}`);
    } catch (error) {
      console.log(`   ❌ ${file}`);
      errorCount++;
    }
  });
  if (files.length > 10) console.log(`   ✅ Moved ${files.length} files`);
});

console.log(`\n✨ Cleanup Complete!`);
console.log(`Moved: ${movedCount} files`);
console.log(`Kept in root: ${skippedCount} files`);
console.log(`Errors: ${errorCount} files`);

// Verify
const remainingMdFiles = readdirSync('.').filter(f => f.endsWith('.md') && statSync(f).isFile());
console.log(`\n📊 Root Directory After Cleanup: ${remainingMdFiles.length} MD files`);
remainingMdFiles.forEach(f => console.log(`   - ${f}`));

console.log(`\n✅ Phase 2 Complete - All files organized, NO DELETIONS`);
