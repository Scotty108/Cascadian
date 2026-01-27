/**
 * Monitor backfill progress and notify when complete
 * Run this to watch the backfill in real-time
 */

import { readFileSync } from 'fs';

const OUTPUT_FILE = '/private/tmp/claude/-Users-scotty-Projects-Cascadian-app/tasks/b2b6f4e.output';
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let lastSize = 0;

function checkProgress() {
  try {
    const content = readFileSync(OUTPUT_FILE, 'utf-8');
    const lines = content.split('\n');

    console.log(`\n=== ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST ===`);

    // Show last 5 lines
    const recentLines = lines.slice(-5).filter(l => l.trim());
    recentLines.forEach(line => console.log(line));

    // Check if complete
    if (content.includes('✓ Complete in') || content.includes('Final counts:')) {
      console.log('\n🎉 BACKFILL COMPLETE!');
      console.log('\nNext step: Phase 3 - Verification before deduplication');
      process.exit(0);
    }

    // Check for errors
    if (content.includes('Error:') || content.includes('ClickHouseError:')) {
      console.log('\n⚠️  ERROR DETECTED - check logs');
      const errorLines = lines.filter(l => l.includes('Error') || l.includes('ClickHouse'));
      errorLines.forEach(line => console.log(line));
    }

    const currentSize = content.length;
    if (currentSize === lastSize) {
      console.log('⚠️  No progress in last 10 minutes - may be stuck');
    }
    lastSize = currentSize;

  } catch (e: any) {
    console.log(`Error reading output file: ${e.message}`);
  }
}

console.log('Monitoring backfill progress...');
console.log('Started: Jan 26, 10:24 PM PST');
console.log('ETA: ~11:30 PM - 12:30 AM PST (1-2 hours)');
console.log('\nChecking every 10 minutes...\n');

// Check immediately
checkProgress();

// Then check every 10 minutes
setInterval(checkProgress, CHECK_INTERVAL_MS);
