#!/usr/bin/env npx tsx

import { execSync } from 'child_process';
import { statSync, readFileSync } from 'fs';
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

function getLastModified(filePath: string): string {
  try {
    // Try git log first (more accurate for committed files)
    const gitDate = execSync(`git log -1 --format="%ai" -- "${filePath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (gitDate) {
      return gitDate.split(' ')[0]; // Return just the date part
    }
  } catch {
    // Fall back to file system stat
  }

  try {
    const stats = statSync(filePath);
    return stats.mtime.toISOString().split('T')[0];
  } catch {
    return 'unknown';
  }
}

function categorizeLocation(path: string): string {
  if (path.startsWith('./docs/')) return 'docs';
  if (path.startsWith('./.agent-os/')) return 'agent-os-hidden';
  if (path.startsWith('./agent-os/')) return 'agent-os-visible';
  if (path.startsWith('./agents/')) return 'agents';
  if (path.startsWith('./reports/')) return 'reports';
  if (path.startsWith('./scripts/')) return 'scripts';
  if (path.startsWith('./runtime/')) return 'runtime';
  if (path.startsWith('./src/')) return 'src';
  return 'root';
}

function extractTopic(filename: string): string {
  const upper = filename.toUpperCase();

  // Topic patterns
  if (upper.includes('BACKFILL')) return 'backfill';
  if (upper.includes('PNL')) return 'pnl';
  if (upper.includes('CONDITION_ID')) return 'condition-id';
  if (upper.includes('RESOLUTION')) return 'resolution';
  if (upper.includes('DATABASE') || upper.includes('SCHEMA')) return 'database';
  if (upper.includes('API') || upper.includes('POLYMARKET')) return 'api';
  if (upper.includes('COVERAGE') || upper.includes('GAP')) return 'coverage';
  if (upper.includes('ERC1155') || upper.includes('ERC20')) return 'blockchain';
  if (upper.includes('WALLET')) return 'wallet';
  if (upper.includes('TRADE')) return 'trading';
  if (upper.includes('MARKET')) return 'market';
  if (upper.includes('AGENT')) return 'agent-work';
  if (upper.includes('ARCHITECTURE')) return 'architecture';
  if (upper.includes('PIPELINE')) return 'pipeline';

  return 'general';
}

function suggestState(path: string, filename: string, lastModified: string): string {
  const upper = filename.toUpperCase();
  const location = categorizeLocation(path);

  // Canonical indicators
  if (filename === 'README.md') return 'canonical';
  if (filename === 'CLAUDE.md') return 'canonical';
  if (upper.includes('ARCHITECTURE_OVERVIEW')) return 'canonical';
  if (upper.includes('QUICK_START')) return 'canonical';
  if (upper.includes('OPERATIONAL_GUIDE')) return 'canonical';
  if (location === 'docs' && !path.includes('archive')) return 'canonical';

  // Historical indicators
  if (path.includes('archive')) return 'historical';
  if (location === 'agent-os-hidden') return 'historical';
  if (location === 'agent-os-visible') return 'historical';

  // WIP indicators
  if (upper.includes('INVESTIGATION')) return 'wip';
  if (upper.includes('ANALYSIS')) return 'wip';
  if (upper.includes('DEBUG')) return 'wip';
  if (upper.includes('CHECK')) return 'wip';
  if (upper.includes('TMP') || upper.includes('TEMP')) return 'wip';
  if (location === 'agents') return 'wip';

  // Status/report indicators (could be historical)
  if (upper.includes('STATUS') || upper.includes('REPORT')) {
    // Recent reports might be canonical
    const modDate = new Date(lastModified);
    const now = new Date();
    const daysDiff = (now.getTime() - modDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff < 7) return 'wip';
    return 'historical';
  }

  // Executive summaries
  if (upper.includes('EXECUTIVE') || upper.includes('SUMMARY') || upper.includes('FINAL')) {
    return 'historical'; // Most summaries are point-in-time
  }

  // Root location defaults
  if (location === 'root') return 'wip'; // Most root files need review

  return 'wip'; // Default to WIP for review
}

function addNotes(path: string, filename: string): string {
  const upper = filename.toUpperCase();
  const notes: string[] = [];

  if (upper.includes('FINAL')) notes.push('Marked as "final"');
  if (upper.includes('COMPLETE')) notes.push('Marked as "complete"');
  if (upper.includes('BREAKTHROUGH') || upper.includes('SMOKING_GUN')) notes.push('Important finding');
  if (upper.includes('CRITICAL') || upper.includes('URGENT')) notes.push('Urgent/critical');
  if (upper.includes('START_HERE') || upper.includes('INDEX')) notes.push('Entry point doc');
  if (upper.includes('MASTER') || upper.includes('REFERENCE')) notes.push('Reference doc');
  if (/[0-9]{2,3}-/.test(filename)) notes.push('Numbered iteration');
  if (filename.length > 50) notes.push('Long filename');

  return notes.join('; ');
}

async function main() {
  const mdListPath = resolve(__dirname, 'md-list.txt');
  const mdFiles = readFileSync(mdListPath, 'utf8')
    .split('\n')
    .filter(line => line.trim());

  console.log(`Processing ${mdFiles.length} markdown files...`);

  const records: DocRecord[] = [];

  for (const filePath of mdFiles) {
    try {
      const fullPath = filePath.startsWith('./') ? filePath.slice(2) : filePath;
      const stats = statSync(filePath);
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n').length;
      const filename = filePath.split('/').pop() || filePath;

      const lastModified = getLastModified(filePath);
      const location = categorizeLocation(filePath);
      const topic = extractTopic(filename);
      const suggestedState = suggestState(filePath, filename, lastModified);
      const notes = addNotes(filePath, filename);

      records.push({
        path: fullPath,
        size: stats.size,
        lines,
        last_modified: lastModified,
        location,
        suggested_state: suggestedState,
        topic,
        notes
      });
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }

  // Sort by location, then by suggested state, then by path
  records.sort((a, b) => {
    if (a.location !== b.location) return a.location.localeCompare(b.location);
    if (a.suggested_state !== b.suggested_state) return a.suggested_state.localeCompare(b.suggested_state);
    return a.path.localeCompare(b.path);
  });

  // Output CSV
  console.log('path,size,lines,last_modified,location,suggested_state,topic,notes');

  for (const record of records) {
    const csvLine = [
      `"${record.path}"`,
      record.size,
      record.lines,
      record.last_modified,
      record.location,
      record.suggested_state,
      record.topic,
      `"${record.notes}"`
    ].join(',');

    console.log(csvLine);
  }

  // Summary stats to stderr
  const stats = {
    total: records.length,
    byLocation: {} as Record<string, number>,
    byState: {} as Record<string, number>,
    byTopic: {} as Record<string, number>,
    totalSize: records.reduce((sum, r) => sum + r.size, 0)
  };

  for (const record of records) {
    stats.byLocation[record.location] = (stats.byLocation[record.location] || 0) + 1;
    stats.byState[record.suggested_state] = (stats.byState[record.suggested_state] || 0) + 1;
    stats.byTopic[record.topic] = (stats.byTopic[record.topic] || 0) + 1;
  }

  console.error('\n=== INVENTORY SUMMARY ===');
  console.error(`Total files: ${stats.total}`);
  console.error(`Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.error('\nBy Location:');
  Object.entries(stats.byLocation)
    .sort(([, a], [, b]) => b - a)
    .forEach(([loc, count]) => console.error(`  ${loc}: ${count}`));
  console.error('\nBy Suggested State:');
  Object.entries(stats.byState)
    .sort(([, a], [, b]) => b - a)
    .forEach(([state, count]) => console.error(`  ${state}: ${count}`));
  console.error('\nTop Topics:');
  Object.entries(stats.byTopic)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .forEach(([topic, count]) => console.error(`  ${topic}: ${count}`));
}

main().catch(console.error);
