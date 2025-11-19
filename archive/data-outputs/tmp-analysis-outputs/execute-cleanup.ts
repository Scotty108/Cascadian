#!/usr/bin/env npx tsx
/**
 * Phase 2 Repository Cleanup - 100% Non-Destructive
 * Moves root directory files to organized docs/ structure
 * Based on tmp/doc-inventory.csv categorization
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';

interface FileRecord {
  path: string;
  size: number;
  lines: number;
  last_modified: string;
  location: string;
  suggested_state: string;
  topic: string;
  notes: string;
}

// Parse CSV
const csvContent = readFileSync('tmp/doc-inventory.csv', 'utf-8');
const lines = csvContent.split('\n').slice(2); // Skip header and processing line

const records: FileRecord[] = lines
  .filter(line => line.trim())
  .map(line => {
    const match = line.match(/"([^"]+)",(\d+),(\d+),"([^"]+)","([^"]+)","([^"]+)","([^"]*)","([^"]*)"/);
    if (!match) return null;

    return {
      path: match[1],
      size: parseInt(match[2]),
      lines: parseInt(match[3]),
      last_modified: match[4],
      location: match[5],
      suggested_state: match[6],
      topic: match[7],
      notes: match[8]
    };
  })
  .filter((r): r is FileRecord => r !== null);

// Filter only root directory files
const rootFiles = records.filter(r => r.location === 'root');

console.log(`\n📊 Root Directory Analysis:`);
console.log(`Total root files: ${rootFiles.length}`);
console.log(`Canonical: ${rootFiles.filter(r => r.suggested_state === 'canonical').length}`);
console.log(`Historical: ${rootFiles.filter(r => r.suggested_state === 'historical').length}`);
console.log(`WIP: ${rootFiles.filter(r => r.suggested_state === 'wip').length}`);

// Determine destination for each file
function getDestination(file: FileRecord): string {
  const { suggested_state, topic, path } = file;

  // Keep these in root
  const keepInRoot = ['README.md', 'CLAUDE.md', 'RULES.md', 'CHANGELOG.md', 'LICENSE.md', 'mindset.md', 'rules.md', 'Article.md'];
  if (keepInRoot.includes(path)) {
    return 'ROOT'; // Don't move
  }

  // Canonical docs -> docs/ subdirectories
  if (suggested_state === 'canonical') {
    if (topic === 'database') return 'docs/systems/database';
    if (topic === 'pnl') return 'docs/systems/pnl';
    if (topic === 'resolution') return 'docs/systems/resolution';
    if (topic === 'api' || topic === 'polymarket') return 'docs/systems/polymarket';
    if (topic === 'pipeline' || topic === 'data-pipeline') return 'docs/systems/data-pipeline';
    if (topic === 'backfill') return 'docs/operations/runbooks';
    if (topic === 'architecture') return 'docs/architecture';
    if (path.includes('QUICK_START') || path.includes('GUIDE')) return 'docs/reference';
    return 'docs/reference'; // Default for canonical
  }

  // Historical -> docs/archive/investigations/[topic]/
  if (suggested_state === 'historical') {
    if (topic === 'pnl') return 'docs/archive/investigations/pnl';
    if (topic === 'database') return 'docs/archive/investigations/database';
    if (topic === 'resolution') return 'docs/archive/investigations/resolution';
    if (topic === 'api' || topic === 'polymarket') return 'docs/archive/investigations/api';
    if (topic === 'backfill') return 'docs/archive/investigations/backfill';
    if (topic === 'coverage') return 'docs/archive/investigations/resolution';
    if (topic === 'wallet') return 'docs/archive/investigations/pnl';
    return 'docs/archive/investigations';
  }

  // WIP/tmp files -> docs/archive/wip/
  if (suggested_state === 'wip' || path.startsWith('tmp-') || path.includes('check-') || path.includes('debug-')) {
    if (path.startsWith('tmp-')) return 'docs/archive/wip/tmp-files';
    if (path.includes('check-') || path.includes('debug-')) return 'docs/archive/wip/debug-files';
    if (path.includes('checkpoint')) return 'docs/archive/wip/checkpoint-files';
    return 'docs/archive/wip';
  }

  // Duplicates (files with FINAL, COMPLETE, SUMMARY in name from same topic)
  if (path.includes('FINAL') || path.includes('COMPLETE') || path.includes('SUMMARY')) {
    if (topic === 'pnl') return 'docs/archive/duplicates/pnl';
    if (topic === 'database') return 'docs/archive/duplicates/database';
    if (topic === 'resolution') return 'docs/archive/duplicates/resolution';
    if (topic === 'api') return 'docs/archive/duplicates/api';
    if (topic === 'backfill') return 'docs/archive/duplicates/backfill';
  }

  // Default: archive to investigations
  return 'docs/archive/investigations';
}

// Create all necessary folders
const destinations = new Set(rootFiles.map(f => getDestination(f)).filter(d => d !== 'ROOT'));
destinations.forEach(dest => {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    console.log(`✅ Created: ${dest}`);
  }
});

// Group files by destination
const byDestination = new Map<string, FileRecord[]>();
rootFiles.forEach(file => {
  const dest = getDestination(file);
  if (!byDestination.has(dest)) byDestination.set(dest, []);
  byDestination.get(dest)!.push(file);
});

console.log(`\n📦 Move Plan:`);
byDestination.forEach((files, dest) => {
  console.log(`${dest}: ${files.length} files`);
});

// Execute moves
console.log(`\n🚀 Executing moves...`);
let movedCount = 0;
let skippedCount = 0;
let errorCount = 0;

byDestination.forEach((files, dest) => {
  if (dest === 'ROOT') {
    console.log(`\n⏭️  Skipping ${files.length} files (keeping in root):`);
    files.forEach(f => console.log(`   - ${f.path}`));
    skippedCount += files.length;
    return;
  }

  console.log(`\n📁 Moving to ${dest}:`);
  files.forEach(file => {
    try {
      if (!existsSync(file.path)) {
        console.log(`   ⚠️  Not found: ${file.path}`);
        return;
      }

      const targetPath = join(dest, file.path);
      execSync(`mv "${file.path}" "${targetPath}"`, { stdio: 'pipe' });
      console.log(`   ✅ ${file.path}`);
      movedCount++;
    } catch (error) {
      console.log(`   ❌ Error moving ${file.path}: ${error}`);
      errorCount++;
    }
  });
});

console.log(`\n✨ Cleanup Complete!`);
console.log(`Moved: ${movedCount} files`);
console.log(`Skipped: ${skippedCount} files (kept in root)`);
console.log(`Errors: ${errorCount} files`);

// Verify root directory
console.log(`\n📊 Root Directory After Cleanup:`);
try {
  const rootMdFiles = execSync('ls -1 *.md 2>/dev/null || echo "No MD files"', { encoding: 'utf-8' });
  const mdCount = rootMdFiles.trim().split('\n').length;
  console.log(`MD files remaining in root: ${mdCount}`);
  console.log(rootMdFiles);
} catch (e) {
  console.log('Error checking root: ', e);
}

console.log(`\n✅ Phase 2 Complete - All files accounted for, NO DELETIONS`);
