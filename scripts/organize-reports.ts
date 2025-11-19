#!/usr/bin/env npx tsx
/**
 * ORGANIZE REPORTS - Auto-organize MD files to proper locations
 *
 * Purpose: Stop MD file chaos by moving report files to organized structure
 * Usage: npm run organize:reports
 *
 * What it does:
 * - Finds all report-style MD files in root directory
 * - Moves them to appropriate locations in reports/
 * - Creates session reports for today if needed
 * - Archives old reports (>30 days)
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');

// Patterns that indicate a report file
const REPORT_PATTERNS = [
  /report/i,
  /summary/i,
  /findings/i,
  /audit/i,
  /investigation/i,
  /analysis/i,
  /status/i,
  /complete/i,
  /final/i,
  /results/i,
  /verification/i,
];

// Files to never move (permanent root files)
const KEEP_IN_ROOT = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'RULES.md',
];

interface ReportFile {
  filename: string;
  fullPath: string;
  isReport: boolean;
  suggestedLocation: string;
}

/**
 * Check if filename matches report patterns
 */
function isReportFile(filename: string): boolean {
  if (KEEP_IN_ROOT.includes(filename)) return false;
  return REPORT_PATTERNS.some(pattern => pattern.test(filename));
}

/**
 * Determine where to move a report file
 */
function getSuggestedLocation(filename: string, content: string): string {
  const lower = filename.toLowerCase();

  // Final reports
  if (lower.includes('final') || lower.includes('complete')) {
    return 'reports/final';
  }

  // Investigation reports (try to extract topic)
  if (lower.includes('investigation') || lower.includes('analysis')) {
    // Extract topic from filename (e.g., PNL_INVESTIGATION -> pnl)
    const topicMatch = filename.match(/^([A-Z_]+)_/);
    if (topicMatch) {
      const topic = topicMatch[1].toLowerCase().replace(/_/g, '-');
      return `reports/investigations/${topic}`;
    }
    return 'reports/investigations/misc';
  }

  // Audit/verification reports
  if (lower.includes('audit') || lower.includes('verification')) {
    return 'reports/final';
  }

  // Default: move to final for manual sorting
  return 'reports/final';
}

/**
 * Find all MD files in root that look like reports
 */
function findReportFiles(): ReportFile[] {
  const files = fs.readdirSync(ROOT_DIR)
    .filter(f => f.endsWith('.md') && fs.statSync(path.join(ROOT_DIR, f)).isFile());

  return files
    .filter(f => isReportFile(f))
    .map(f => {
      const fullPath = path.join(ROOT_DIR, f);
      const content = fs.readFileSync(fullPath, 'utf-8');
      return {
        filename: f,
        fullPath,
        isReport: true,
        suggestedLocation: getSuggestedLocation(f, content),
      };
    });
}

/**
 * Archive old reports (>30 days)
 */
function archiveOldReports() {
  const sessionsDir = path.join(REPORTS_DIR, 'sessions');
  if (!fs.existsSync(sessionsDir)) return;

  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const files = fs.readdirSync(sessionsDir);

  files.forEach(file => {
    const filePath = path.join(sessionsDir, file);
    const stats = fs.statSync(filePath);

    if (stats.mtimeMs < thirtyDaysAgo) {
      // Archive by month
      const date = new Date(stats.mtime);
      const archiveMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const archiveDir = path.join(REPORTS_DIR, 'archive', archiveMonth);

      fs.mkdirSync(archiveDir, { recursive: true });
      const newPath = path.join(archiveDir, file);

      console.log(`📦 Archiving old report: ${file} → archive/${archiveMonth}/`);
      fs.renameSync(filePath, newPath);
    }
  });
}

/**
 * Main execution
 */
function main() {
  console.log('🔍 Scanning for report files in root directory...\n');

  const reportFiles = findReportFiles();

  if (reportFiles.length === 0) {
    console.log('✅ No report files found in root. All clean!');
    return;
  }

  console.log(`Found ${reportFiles.length} report file(s) to organize:\n`);

  reportFiles.forEach((report, index) => {
    console.log(`${index + 1}. ${report.filename}`);
    console.log(`   → ${report.suggestedLocation}/\n`);

    // Create destination directory
    const destDir = path.join(ROOT_DIR, report.suggestedLocation);
    fs.mkdirSync(destDir, { recursive: true });

    // Move file
    const destPath = path.join(destDir, report.filename);

    // Handle duplicates
    let finalDestPath = destPath;
    let counter = 1;
    while (fs.existsSync(finalDestPath)) {
      const ext = path.extname(report.filename);
      const base = path.basename(report.filename, ext);
      finalDestPath = path.join(destDir, `${base}-${counter}${ext}`);
      counter++;
    }

    fs.renameSync(report.fullPath, finalDestPath);
    console.log(`   ✅ Moved to ${path.relative(ROOT_DIR, finalDestPath)}\n`);
  });

  // Archive old session reports
  console.log('\n📦 Checking for old reports to archive...\n');
  archiveOldReports();

  console.log('\n✨ Organization complete!');
  console.log('\nReport structure:');
  console.log('  reports/');
  console.log('  ├── sessions/      # Current work sessions');
  console.log('  ├── investigations/ # Topic-based deep dives');
  console.log('  ├── final/         # Completed reports');
  console.log('  └── archive/       # Old reports (>30 days)');
}

// Run if called directly
if (require.main === module) {
  main();
}
