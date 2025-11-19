#!/usr/bin/env npx tsx
/**
 * Monitor CLOB Coverage in Real-Time
 *
 * Displays current coverage and tracks backfill progress
 *
 * Usage:
 *   npx tsx scripts/monitor-clob-coverage.ts
 *   watch -n 10 npx tsx scripts/monitor-clob-coverage.ts
 */

import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Load .env.local
config({ path: path.resolve(process.cwd(), '.env.local') });

interface Checkpoint {
  startedAt: string;
  lastSavedAt: string;
  totalMarkets: number;
  processedMarkets: number;
  successfulMarkets: number;
  failedMarkets: number;
  skippedMarkets: number;
  processedConditionIds: string[];
  failedConditionIds: string[];
}

async function getCurrentCoverage() {
  const query = `
    WITH total AS (
      SELECT count(*) as total FROM gamma_markets
    ),
    with_fills AS (
      SELECT count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as with_fills
      FROM clob_fills
    )
    SELECT
      total.total as total_markets,
      with_fills.with_fills as markets_with_fills,
      round(100.0 * with_fills.with_fills / total.total, 2) as coverage_pct,
      total.total - with_fills.with_fills as missing_markets
    FROM total, with_fills
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<any[]>();
  return rows[0];
}

async function getRecentFills() {
  const query = `
    SELECT
      toDate(timestamp) as date,
      count(*) as fill_count,
      uniq(lower(replaceAll(condition_id, '0x', ''))) as market_count
    FROM clob_fills
    WHERE timestamp >= now() - INTERVAL 7 DAY
    GROUP BY date
    ORDER BY date DESC
    LIMIT 7
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return result.json<any[]>();
}

async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const data = await fs.readFile('tmp/clob-backfill-checkpoint.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function main() {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    CLOB COVERAGE MONITOR                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  console.log(`📅 ${timestamp} PST\n`);

  // Current coverage
  console.log('📊 CURRENT COVERAGE');
  console.log('─'.repeat(80));

  const coverage = await getCurrentCoverage();
  console.log(`Total Markets:        ${coverage.total_markets.toLocaleString()}`);
  console.log(`Markets with Fills:   ${coverage.markets_with_fills.toLocaleString()}`);
  console.log(`Missing:              ${coverage.missing_markets.toLocaleString()}`);
  console.log(`Coverage:             ${coverage.coverage_pct}%`);

  const bar = '█'.repeat(Math.floor(coverage.coverage_pct / 2)) +
              '░'.repeat(50 - Math.floor(coverage.coverage_pct / 2));
  console.log(`Progress:             [${bar}]`);

  // Checkpoint status
  console.log('\n📍 CHECKPOINT STATUS');
  console.log('─'.repeat(80));

  const checkpoint = await loadCheckpoint();
  if (checkpoint) {
    const startedAt = new Date(checkpoint.startedAt);
    const lastSavedAt = new Date(checkpoint.lastSavedAt);
    const elapsedMinutes = (Date.now() - startedAt.getTime()) / 1000 / 60;
    const rate = checkpoint.processedMarkets / elapsedMinutes;
    const remaining = checkpoint.totalMarkets - checkpoint.processedMarkets;
    const etaMinutes = remaining / rate;

    console.log(`Started:              ${startedAt.toLocaleString()}`);
    console.log(`Last Saved:           ${lastSavedAt.toLocaleString()}`);
    console.log(`Total Target:         ${checkpoint.totalMarkets.toLocaleString()}`);
    console.log(`Processed:            ${checkpoint.processedMarkets.toLocaleString()} (${((checkpoint.processedMarkets / checkpoint.totalMarkets) * 100).toFixed(1)}%)`);
    console.log(`  ✅ Successful:      ${checkpoint.successfulMarkets.toLocaleString()}`);
    console.log(`  ⚪ Empty (0 fills):  ${checkpoint.skippedMarkets.toLocaleString()}`);
    console.log(`  ❌ Failed:          ${checkpoint.failedMarkets.toLocaleString()}`);
    console.log(`Rate:                 ${rate.toFixed(2)} markets/min`);
    console.log(`ETA:                  ${Math.floor(etaMinutes / 60)}h ${Math.floor(etaMinutes % 60)}m`);
  } else {
    console.log('No active checkpoint found');
  }

  // Recent activity
  console.log('\n📈 RECENT ACTIVITY (Last 7 Days)');
  console.log('─'.repeat(80));

  const recentFills = await getRecentFills();
  console.log('Date          Fills        Markets');
  console.log('─'.repeat(40));
  for (const row of recentFills) {
    const date = row.date.toString().substring(0, 10);
    const fills = row.fill_count.toLocaleString().padEnd(12);
    const markets = row.market_count.toLocaleString();
    console.log(`${date}    ${fills} ${markets}`);
  }

  // Next steps
  console.log('\n💡 NEXT STEPS');
  console.log('─'.repeat(80));

  if (coverage.coverage_pct >= 95) {
    console.log('✅ Coverage ≥95% - Ready for P&L calculations!');
  } else if (coverage.coverage_pct >= 90) {
    console.log('⚠️  Coverage 90-95% - Consider acceptable for limited launch');
    console.log(`   Need ${coverage.missing_markets.toLocaleString()} more markets for 95%`);
  } else {
    console.log(`⏳ Coverage ${coverage.coverage_pct}% - Continue backfill`);
    console.log(`   Need ${coverage.missing_markets.toLocaleString()} more markets for 95%`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('Tip: Run with `watch -n 10` for auto-refresh every 10 seconds');
  console.log('═'.repeat(80) + '\n');
}

main().catch(console.error);
