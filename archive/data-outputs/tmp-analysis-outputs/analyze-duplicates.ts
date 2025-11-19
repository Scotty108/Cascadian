#!/usr/bin/env npx tsx

import { readFileSync } from 'fs';
import { resolve } from 'path';

interface DocRecord {
  path: string;
  size: number;
  lines: number;
  last_modified: string;
  location: string;
  suggested_state: string;
  topic: string;
  notes: string;
}

function parseCSV(csvPath: string): DocRecord[] {
  const content = readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').slice(1); // Skip header

  return lines
    .filter(line => line.trim())
    .map(line => {
      // Simple CSV parser (handles quoted fields)
      const match = line.match(/"([^"]+)",(\d+),(\d+),([^,]+),([^,]+),([^,]+),([^,]+),"([^"]*)"/);

      if (!match) {
        console.error('Failed to parse line:', line);
        return null;
      }

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
    .filter((r): r is DocRecord => r !== null);
}

function findDuplicateTopics(records: DocRecord[]): Map<string, DocRecord[]> {
  const byTopic = new Map<string, DocRecord[]>();

  for (const record of records) {
    const existing = byTopic.get(record.topic) || [];
    existing.push(record);
    byTopic.set(record.topic, existing);
  }

  // Only return topics with multiple files
  const duplicates = new Map<string, DocRecord[]>();
  for (const [topic, files] of byTopic.entries()) {
    if (files.length > 1 && topic !== 'general') {
      duplicates.set(topic, files);
    }
  }

  return duplicates;
}

function findSimilarFilenames(records: DocRecord[]): Map<string, DocRecord[]> {
  const groups = new Map<string, DocRecord[]>();

  for (const record of records) {
    const filename = record.path.split('/').pop() || '';
    const baseName = filename
      .replace(/\.md$/, '')
      .replace(/_FINAL|_COMPLETE|_SUMMARY|_EXECUTIVE|_REPORT/g, '')
      .replace(/[-_]\d+$/g, ''); // Remove trailing numbers

    const existing = groups.get(baseName) || [];
    existing.push(record);
    groups.set(baseName, existing);
  }

  // Only return groups with multiple files
  const similar = new Map<string, DocRecord[]>();
  for (const [baseName, files] of groups.entries()) {
    if (files.length > 1) {
      similar.set(baseName, files);
    }
  }

  return similar;
}

function identifyCanonicalCandidates(records: DocRecord[]): DocRecord[] {
  return records
    .filter(r => {
      // High-value indicators
      const filename = r.path.split('/').pop()?.toUpperCase() || '';
      const isInDocs = r.location === 'docs' && !r.path.includes('archive');
      const isReference = filename.includes('REFERENCE') || filename.includes('MASTER');
      const isArchitecture = filename.includes('ARCHITECTURE');
      const isQuickStart = filename.includes('QUICK_START');
      const isOperational = filename.includes('OPERATIONAL');
      const isLarge = r.lines > 200; // Substantial docs
      const isRecent = new Date(r.last_modified) > new Date('2025-11-01');

      return (isInDocs && isLarge) || isReference || isArchitecture || isQuickStart || isOperational;
    })
    .sort((a, b) => b.size - a.size);
}

async function main() {
  const csvPath = resolve(__dirname, 'doc-inventory.csv');
  const records = parseCSV(csvPath);

  console.log('# Duplicate & Organization Analysis\n');

  // 1. Summary stats
  console.log('## Summary Statistics\n');
  console.log(`- Total files: ${records.length}`);
  console.log(`- Root directory files: ${records.filter(r => r.location === 'root').length}`);
  console.log(`- docs/ files: ${records.filter(r => r.location === 'docs').length}`);
  console.log(`- Agent OS files: ${records.filter(r => r.location.includes('agent-os')).length}`);
  console.log(`- Files marked WIP: ${records.filter(r => r.suggested_state === 'wip').length}`);
  console.log(`- Files marked historical: ${records.filter(r => r.suggested_state === 'historical').length}`);
  console.log(`- Files marked canonical: ${records.filter(r => r.suggested_state === 'canonical').length}`);
  console.log();

  // 2. Duplicate topics
  console.log('## Topics with Multiple Files (Duplicate Content Risk)\n');
  const duplicateTopics = findDuplicateTopics(records);
  const topDuplicates = Array.from(duplicateTopics.entries())
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 15);

  for (const [topic, files] of topDuplicates) {
    console.log(`### ${topic} (${files.length} files)\n`);

    // Show locations
    const locations = files.reduce((acc, f) => {
      acc[f.location] = (acc[f.location] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`Locations: ${Object.entries(locations).map(([loc, count]) => `${loc}(${count})`).join(', ')}\n`);

    // Show newest 3
    const newest = files
      .sort((a, b) => b.last_modified.localeCompare(a.last_modified))
      .slice(0, 3);

    console.log('Most recent files:');
    for (const file of newest) {
      console.log(`- ${file.path.split('/').pop()} (${file.last_modified}, ${file.location})`);
    }
    console.log();
  }

  // 3. Similar filenames
  console.log('## Similar Filenames (Likely Duplicates)\n');
  const similarFiles = findSimilarFilenames(records);
  const topSimilar = Array.from(similarFiles.entries())
    .filter(([, files]) => files.length >= 3) // Only show groups of 3+
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 10);

  for (const [baseName, files] of topSimilar) {
    console.log(`### ${baseName} (${files.length} variants)\n`);
    const sorted = files.sort((a, b) => b.last_modified.localeCompare(a.last_modified));

    for (const file of sorted) {
      const filename = file.path.split('/').pop();
      console.log(`- ${filename} (${file.last_modified}, ${file.location}, ${file.lines} lines)`);
    }
    console.log();
  }

  // 4. Canonical candidates
  console.log('## High-Value Canonical Candidates (Keep & Organize)\n');
  const candidates = identifyCanonicalCandidates(records);

  console.log(`Found ${candidates.length} high-value documents\n`);

  const byLocation = candidates.reduce((acc, c) => {
    acc[c.location] = acc[c.location] || [];
    acc[c.location].push(c);
    return acc;
  }, {} as Record<string, DocRecord[]>);

  for (const [location, files] of Object.entries(byLocation)) {
    console.log(`### ${location} (${files.length} files)\n`);

    const sorted = files.sort((a, b) => b.size - a.size).slice(0, 10);
    for (const file of sorted) {
      const filename = file.path.split('/').pop();
      console.log(`- ${filename} (${(file.size / 1024).toFixed(1)}KB, ${file.lines} lines, ${file.topic})`);
    }
    console.log();
  }

  // 5. Root directory breakdown
  console.log('## Root Directory Breakdown (Highest Cleanup Priority)\n');
  const rootFiles = records.filter(r => r.location === 'root');

  const rootByTopic = rootFiles.reduce((acc, f) => {
    acc[f.topic] = (acc[f.topic] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('Files by topic:');
  Object.entries(rootByTopic)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .forEach(([topic, count]) => console.log(`- ${topic}: ${count}`));
  console.log();

  // Pattern analysis
  const patterns = {
    investigation: rootFiles.filter(f => f.path.toUpperCase().includes('INVESTIGATION')).length,
    analysis: rootFiles.filter(f => f.path.toUpperCase().includes('ANALYSIS')).length,
    status: rootFiles.filter(f => f.path.toUpperCase().includes('STATUS')).length,
    report: rootFiles.filter(f => f.path.toUpperCase().includes('REPORT')).length,
    summary: rootFiles.filter(f => f.path.toUpperCase().includes('SUMMARY')).length,
    final: rootFiles.filter(f => f.path.toUpperCase().includes('FINAL')).length,
    complete: rootFiles.filter(f => f.path.toUpperCase().includes('COMPLETE')).length,
    guide: rootFiles.filter(f => f.path.toUpperCase().includes('GUIDE')).length,
    reference: rootFiles.filter(f => f.path.toUpperCase().includes('REFERENCE')).length,
  };

  console.log('Files by pattern:');
  Object.entries(patterns)
    .sort(([, a], [, b]) => b - a)
    .forEach(([pattern, count]) => console.log(`- *${pattern.toUpperCase()}*: ${count}`));
  console.log();

  // 6. Recommendations
  console.log('## Recommended Actions by Priority\n');
  console.log('### Priority 1: Root Directory Cleanup\n');
  console.log(`- **564 files** in root need triage`);
  console.log(`- **${patterns.investigation + patterns.analysis}** investigation/analysis files → Move to docs/archive/investigations/ or delete`);
  console.log(`- **${patterns.status + patterns.report + patterns.summary}** status/report/summary files → Archive dated reports, delete duplicates`);
  console.log(`- **${patterns.final + patterns.complete}** "final"/"complete" files → Consolidate, keep latest only`);
  console.log();

  console.log('### Priority 2: Consolidate Agent OS Folders\n');
  console.log(`- **.agent-os/ (hidden)**: 101 files from Oct 23-27 → Archive to docs/archive/agent-os-oct-2025/`);
  console.log(`- **agent-os/ (visible)**: 24 files from Oct 26-28 → Review for unique content, likely delete`);
  console.log();

  console.log('### Priority 3: Duplicate Topic Consolidation\n');
  const topTopics = Array.from(duplicateTopics.entries())
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5);

  for (const [topic, files] of topTopics) {
    console.log(`- **${topic}**: ${files.length} files → Consolidate to 1-2 canonical docs`);
  }
  console.log();

  console.log('### Priority 4: Establish docs/ Structure\n');
  console.log('- Keep docs/ as single source of truth');
  console.log('- Move valuable root docs to appropriate subdirectories');
  console.log('- Archive historical investigations');
  console.log();
}

main().catch(console.error);
