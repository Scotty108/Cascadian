#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

interface TableStats {
  name: string;
  total_rows: number;
  valid_64char: number;
  has_prefix: number;
  has_uppercase: number;
  invalid_length: number;
}

async function main() {
  console.log('=== TABLE SWAP MONITORING ===\n');
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Check both tables exist and get row counts
  const tablesResult = await clickhouse.query({
    query: `
      SELECT
        name,
        total_rows
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('trades_with_direction', 'trades_with_direction_backup')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json<Array<{ name: string; total_rows: string }>>();

  if (tables.length === 0) {
    console.error('❌ ERROR: Neither trades_with_direction nor backup table found!');
    process.exit(1);
  }

  console.log('--- TABLE STATUS ---\n');
  tables.forEach(t => {
    console.log(`  ${t.name}: ${parseInt(t.total_rows || '0').toLocaleString()} rows`);
  });
  console.log();

  // Get quality metrics for active table
  const activeTable = tables.find(t => t.name === 'trades_with_direction');
  if (!activeTable) {
    console.error('❌ ERROR: Active table trades_with_direction not found!');
    console.error('   Run table swap to activate repaired table.\n');
    process.exit(1);
  }

  console.log('--- ACTIVE TABLE QUALITY ---\n');

  const qualityResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(length(condition_id_norm) = 64) as valid_64char,
        countIf(condition_id_norm LIKE '0x%') as has_prefix,
        countIf(condition_id_norm != lower(condition_id_norm)) as has_uppercase,
        countIf(length(condition_id_norm) != 64) as invalid_length
      FROM default.trades_with_direction
    `,
    format: 'JSONEachRow'
  });
  const quality = await qualityResult.json<Array<any>>();

  const total = parseInt(quality[0].total);
  const valid = parseInt(quality[0].valid_64char);
  const prefix = parseInt(quality[0].has_prefix);
  const uppercase = parseInt(quality[0].has_uppercase);
  const invalid = parseInt(quality[0].invalid_length);

  console.log(`  Total rows:       ${total.toLocaleString()}`);
  console.log(`  Valid (64-char):  ${valid.toLocaleString()} (${((valid/total)*100).toFixed(2)}%)`);
  console.log(`  Has 0x prefix:    ${prefix.toLocaleString()}`);
  console.log(`  Has uppercase:    ${uppercase.toLocaleString()}`);
  console.log(`  Invalid length:   ${invalid.toLocaleString()}\n`);

  // Validate quality gates
  let hasIssues = false;

  if (valid !== total) {
    console.error(`❌ QUALITY ALERT: Not all rows have valid 64-char condition IDs`);
    console.error(`   Expected: ${total.toLocaleString()}, Got: ${valid.toLocaleString()}\n`);
    hasIssues = true;
  }

  if (prefix > 0) {
    console.error(`❌ QUALITY ALERT: ${prefix.toLocaleString()} rows still have 0x prefix`);
    console.error(`   Expected: 0\n`);
    hasIssues = true;
  }

  if (uppercase > 0) {
    console.error(`⚠️  WARNING: ${uppercase.toLocaleString()} rows have uppercase characters`);
    console.error(`   Expected: 0 (all lowercase)\n`);
    hasIssues = true;
  }

  if (invalid > 0) {
    console.error(`❌ QUALITY ALERT: ${invalid.toLocaleString()} rows have invalid length`);
    console.error(`   Expected: 0\n`);
    hasIssues = true;
  }

  // Check for divergence between active and backup
  const backupTable = tables.find(t => t.name === 'trades_with_direction_backup');
  if (backupTable) {
    const activeRows = parseInt(activeTable.total_rows || '0');
    const backupRows = parseInt(backupTable.total_rows || '0');
    const diff = activeRows - backupRows;
    const diffPct = ((diff / backupRows) * 100).toFixed(2);

    console.log('--- TABLE COMPARISON ---\n');
    console.log(`  Active:  ${activeRows.toLocaleString()} rows`);
    console.log(`  Backup:  ${backupRows.toLocaleString()} rows`);
    console.log(`  Diff:    ${diff > 0 ? '+' : ''}${diff.toLocaleString()} rows (${diffPct}%)\n`);

    if (Math.abs(parseFloat(diffPct)) > 20) {
      console.error(`⚠️  WARNING: Large divergence between active and backup (${diffPct}%)`);
      console.error(`   This may indicate data loss or corruption during swap.\n`);
      hasIssues = true;
    }
  }

  // Final verdict
  if (!hasIssues) {
    console.log('✅ ALL CHECKS PASSED');
    console.log('   Table swap is stable and quality is good.\n');
  } else {
    console.error('❌ ISSUES DETECTED');
    console.error('   Review alerts above and investigate.\n');
    process.exit(1);
  }
}

main().catch(console.error);
