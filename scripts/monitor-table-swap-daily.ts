#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';
import { writeFileSync, existsSync, readFileSync } from 'fs';

interface DailySnapshot {
  date: string;
  active_rows: number;
  backup_rows: number;
  drift_pct: number;
  quality_valid_pct: number;
  quality_issues: number;
}

interface MutationRecord {
  database: string;
  table: string;
  mutation_id: string;
  command: string;
  create_time: string;
  is_done: number;
  latest_fail_reason: string;
}

const LOG_FILE = './table-swap-monitor-log.json';

async function main() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  console.log('=== DAILY TABLE SWAP MONITOR ===');
  console.log(`Date: ${dateStr}`);
  console.log(`Time: ${now.toISOString()}\n`);

  // Load previous snapshots
  let history: DailySnapshot[] = [];
  if (existsSync(LOG_FILE)) {
    history = JSON.parse(readFileSync(LOG_FILE, 'utf-8'));
  }

  // Get current table stats
  const tablesResult = await clickhouse.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('trades_with_direction', 'trades_with_direction_backup')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json<Array<{ name: string; total_rows: string }>>();

  const activeTable = tables.find(t => t.name === 'trades_with_direction');
  const backupTable = tables.find(t => t.name === 'trades_with_direction_backup');

  if (!activeTable) {
    console.error('❌ CRITICAL: Active table trades_with_direction not found!\n');
    process.exit(1);
  }

  const activeRows = parseInt(activeTable.total_rows || '0');
  const backupRows = parseInt(backupTable?.total_rows || '0');
  const diffPct = backupRows > 0 ? ((activeRows - backupRows) / backupRows * 100) : 0;

  console.log('--- TABLE STATUS ---\n');
  console.log(`  Active:  ${activeRows.toLocaleString()} rows`);
  console.log(`  Backup:  ${backupRows.toLocaleString()} rows`);
  console.log(`  Drift:   ${diffPct > 0 ? '+' : ''}${diffPct.toFixed(2)}%\n`);

  // Get quality metrics
  const qualityResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(length(condition_id_norm) = 64) as valid,
        countIf(condition_id_norm LIKE '0x%') as has_prefix,
        countIf(condition_id_norm != lower(condition_id_norm)) as has_uppercase,
        countIf(length(condition_id_norm) != 64) as invalid_length
      FROM default.trades_with_direction
    `,
    format: 'JSONEachRow'
  });
  const quality = await qualityResult.json<Array<any>>();

  const total = parseInt(quality[0].total);
  const valid = parseInt(quality[0].valid);
  const issues = total - valid;
  const validPct = (valid / total) * 100;

  console.log('--- QUALITY ---\n');
  console.log(`  Valid:   ${valid.toLocaleString()} / ${total.toLocaleString()} (${validPct.toFixed(2)}%)`);
  console.log(`  Issues:  ${issues.toLocaleString()}\n`);

  // Check for drift vs yesterday
  let driftDetected = false;
  const yesterday = history[history.length - 1];

  if (yesterday) {
    const rowDrift = ((activeRows - yesterday.active_rows) / yesterday.active_rows) * 100;
    const qualityDrift = validPct - yesterday.quality_valid_pct;

    console.log('--- DRIFT DETECTION ---\n');
    console.log(`  Yesterday: ${yesterday.active_rows.toLocaleString()} rows (${yesterday.quality_valid_pct.toFixed(2)}% valid)`);
    console.log(`  Today:     ${activeRows.toLocaleString()} rows (${validPct.toFixed(2)}% valid)`);
    console.log(`  Row drift: ${rowDrift > 0 ? '+' : ''}${rowDrift.toFixed(4)}%`);
    console.log(`  Quality drift: ${qualityDrift > 0 ? '+' : ''}${qualityDrift.toFixed(4)}%\n`);

    // Drift thresholds
    if (Math.abs(rowDrift) > 0.1) {
      console.warn(`⚠️  ROW DRIFT DETECTED: ${rowDrift.toFixed(4)}% change from yesterday`);
      driftDetected = true;
    }
    if (Math.abs(qualityDrift) > 0.01) {
      console.warn(`⚠️  QUALITY DRIFT DETECTED: ${qualityDrift.toFixed(4)}% change from yesterday`);
      driftDetected = true;
    }
  } else {
    console.log('--- BASELINE ---\n');
    console.log('  No previous snapshot, establishing baseline.\n');
  }

  // If drift detected, capture system.mutations
  if (driftDetected) {
    console.log('\n=== CAPTURING MUTATIONS (Drift Detected) ===\n');

    const mutationsResult = await clickhouse.query({
      query: `
        SELECT
          database,
          table,
          mutation_id,
          command,
          create_time,
          is_done,
          latest_fail_reason
        FROM system.mutations
        WHERE database = 'default'
          AND table LIKE 'trades_with_direction%'
        ORDER BY create_time DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });
    const mutations = await mutationsResult.json<MutationRecord[]>();

    if (mutations.length === 0) {
      console.log('  No mutations found in system.mutations table.\n');
    } else {
      console.log(`  Found ${mutations.length} mutations:\n`);

      // Flag ALTER/MERGE operations
      const alterOps = mutations.filter(m =>
        m.command.toUpperCase().includes('ALTER TABLE') ||
        m.command.toUpperCase().includes('MERGE')
      );

      if (alterOps.length > 0) {
        console.log(`  ⚠️  FLAGGED: ${alterOps.length} ALTER/MERGE operation(s) detected\n`);
      }

      mutations.forEach((m, i) => {
        const isAlterOrMerge = m.command.toUpperCase().includes('ALTER TABLE') ||
                                m.command.toUpperCase().includes('MERGE');
        const flag = isAlterOrMerge ? '🚨 ' : '   ';

        console.log(`  ${flag}${i + 1}. ${m.table} - ${m.mutation_id}`);
        console.log(`     Command: ${m.command.substring(0, 80)}${m.command.length > 80 ? '...' : ''}`);
        console.log(`     Created: ${m.create_time}`);
        console.log(`     Status: ${m.is_done ? 'DONE ✅' : 'IN PROGRESS 🔄'}`);
        if (m.latest_fail_reason) {
          console.log(`     Error: ${m.latest_fail_reason}`);
        }
        console.log();
      });
    }

    // Save mutations to file
    const mutationsFile = `./table-swap-mutations-${dateStr}.json`;
    writeFileSync(mutationsFile, JSON.stringify(mutations, null, 2));
    console.log(`  Mutations saved to: ${mutationsFile}\n`);
  }

  // Save today's snapshot
  const snapshot: DailySnapshot = {
    date: dateStr,
    active_rows: activeRows,
    backup_rows: backupRows,
    drift_pct: diffPct,
    quality_valid_pct: validPct,
    quality_issues: issues
  };

  history.push(snapshot);

  // Keep only last 30 days
  if (history.length > 30) {
    history = history.slice(-30);
  }

  writeFileSync(LOG_FILE, JSON.stringify(history, null, 2));
  console.log(`Snapshot saved to: ${LOG_FILE}\n`);

  // Final verdict
  if (driftDetected) {
    console.error('❌ DRIFT DETECTED - Review mutations output above');
    process.exit(1);
  } else if (issues > 0) {
    console.warn('⚠️  Quality issues detected but stable');
  } else {
    console.log('✅ ALL STABLE - No drift detected');
  }
}

main().catch(console.error);
