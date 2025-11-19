#!/usr/bin/env npx tsx
/**
 * Export Leaderboards to JSON
 *
 * Creates JSON exports for all three leaderboard views:
 * - leaderboard_whale_TIMESTAMP.json (top 50 by P&L)
 * - leaderboard_omega_TIMESTAMP.json (top 50 by omega ratio)
 * - leaderboard_roi_TIMESTAMP.json (top 50 by ROI%)
 *
 * Output format:
 * {
 *   "metadata": { ... },
 *   "leaderboard": [ { rank: 1, wallet_address: "0x...", ... }, ... ]
 * }
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('EXPORTING LEADERBOARDS TO JSON');
  console.log('═'.repeat(100) + '\n');

  try {
    // Ensure exports directory exists
    const exportsDir = resolve(process.cwd(), 'exports');
    mkdirSync(exportsDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const calculatedAt = new Date().toISOString();

    const leaderboards = [
      { name: 'whale', view: 'whale_leaderboard', metric: 'realized_pnl', description: 'Top 50 by Realized P&L' },
      { name: 'omega', view: 'omega_leaderboard', metric: 'omega_ratio', description: 'Top 50 by Omega Ratio (min 10 trades)' },
      { name: 'roi', view: 'roi_leaderboard', metric: 'roi_pct', description: 'Top 50 by ROI% (min 5 trades)' }
    ];

    for (const lb of leaderboards) {
      console.log(`${lb.name.toUpperCase()} Leaderboard\n`);
      console.log(`  Fetching from ${lb.view}...`);

      const query = `SELECT * FROM default.${lb.view} ORDER BY rank`;
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const rows = await result.json<any[]>();

      console.log(`  ✅ Fetched ${rows.length} rows\n`);

      // Transform rows
      const leaderboardData = rows.map(row => {
        const entry: any = {
          rank: parseInt(row.rank),
          wallet_address: row.wallet_address
        };

        // Add all numeric fields with proper formatting
        Object.keys(row).forEach(key => {
          if (key !== 'rank' && key !== 'wallet_address') {
            const value = row[key];
            if (typeof value === 'string' && !isNaN(parseFloat(value))) {
              entry[key] = parseFloat(value);
            } else {
              entry[key] = value;
            }
          }
        });

        return entry;
      });

      // Create export object
      const output = {
        metadata: {
          leaderboard_type: lb.name,
          description: lb.description,
          primary_metric: lb.metric,
          exported_at: timestamp,
          calculated_at: calculatedAt,
          total_entries: leaderboardData.length,
          schema_version: '1.0'
        },
        leaderboard: leaderboardData
      };

      // Write to file
      const filename = `leaderboard_${lb.name}_${timestamp.replace(/[:.]/g, '-')}.json`;
      const filepath = resolve(exportsDir, filename);

      writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');

      const fileSizeKB = (Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(2);

      console.log(`  ✅ Wrote ${filename} (${fileSizeKB} KB)\n`);
    }

    // Summary
    console.log('═'.repeat(100));
    console.log('EXPORTS COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ All leaderboards exported to JSON\n`);
    console.log(`Files created:\n`);
    leaderboards.forEach(lb => {
      const filename = `leaderboard_${lb.name}_${timestamp.replace(/[:.]/g, '-')}.json`;
      console.log(`  • ${filename}`);
    });
    console.log(`\nFormat: UTF-8 JSON with metadata and ranked entries\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
