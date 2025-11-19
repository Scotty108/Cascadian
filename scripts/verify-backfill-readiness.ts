/**
 * Verify Backfill Readiness
 *
 * Checks all prerequisites before running the payout backfill:
 * - ClickHouse connection
 * - Table schema exists
 * - Input file is valid
 * - No conflicting data
 *
 * USAGE:
 *   npx tsx verify-backfill-readiness.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import * as fs from 'fs';
import { clickhouse } from '@/lib/clickhouse/client';

async function checkClickHouseConnection() {
  console.log('\n1️⃣  Checking ClickHouse connection...');

  try {
    await clickhouse.ping();
    console.log('   ✅ Connected to ClickHouse');
    return true;
  } catch (error) {
    console.error('   ❌ Failed to connect:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkTableSchema() {
  console.log('\n2️⃣  Checking resolutions_external_ingest table...');

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE database = 'default'
          AND name = 'resolutions_external_ingest'
        FORMAT JSONEachRow
      `,
    });

    const data = await result.json<any>();

    if (data.length === 0) {
      console.error('   ❌ Table does not exist!');
      console.log('\n   Create it with:');
      console.log(`
      CREATE TABLE IF NOT EXISTS default.resolutions_external_ingest (
        condition_id String,
        payout_numerators Array(UInt32),
        payout_denominator UInt32,
        winning_index Int32,
        resolved_at DateTime,
        source LowCardinality(String)
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY condition_id;
      `);
      return false;
    }

    const table = data[0];
    console.log('   ✅ Table exists');
    console.log(`      Engine: ${table.engine}`);
    console.log(`      Rows: ${parseInt(table.total_rows).toLocaleString()}`);
    console.log(`      Size: ${(parseInt(table.total_bytes) / 1024 / 1024).toFixed(2)} MB`);

    // Check schema
    const schemaResult = await clickhouse.query({
      query: `DESCRIBE TABLE default.resolutions_external_ingest FORMAT JSONEachRow`,
    });

    const schema = await schemaResult.json<{ name: string; type: string }>();
    const requiredColumns = [
      'condition_id',
      'payout_numerators',
      'payout_denominator',
      'winning_index',
      'resolved_at',
      'source',
    ];

    const missingColumns = requiredColumns.filter(
      col => !schema.some(s => s.name === col)
    );

    if (missingColumns.length > 0) {
      console.error('   ❌ Missing columns:', missingColumns.join(', '));
      return false;
    }

    console.log('   ✅ Schema validated');
    return true;

  } catch (error) {
    console.error('   ❌ Error checking table:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkInputFile() {
  console.log('\n3️⃣  Checking input file...');

  const filePath = resolve(process.cwd(), 'reports/condition_ids_missing_api.txt');

  try {
    if (!fs.existsSync(filePath)) {
      console.error(`   ❌ File not found: ${filePath}`);
      return false;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');

    console.log('   ✅ File exists');
    console.log(`      Path: ${filePath}`);
    console.log(`      Lines: ${lines.length.toLocaleString()}`);
    console.log(`      Size: ${(content.length / 1024).toFixed(2)} KB`);

    // Validate format (first 10 lines)
    const invalidLines = lines.slice(0, 10).filter(line => {
      const trimmed = line.trim();
      return trimmed.length !== 64 || !/^[0-9a-f]+$/i.test(trimmed);
    });

    if (invalidLines.length > 0) {
      console.error('   ❌ Invalid ID format detected:');
      invalidLines.forEach(line => console.error(`      ${line}`));
      return false;
    }

    console.log('   ✅ Format validated (64-char hex, no 0x prefix)');

    // Sample IDs
    console.log('\n   Sample IDs:');
    lines.slice(0, 3).forEach((id, i) => console.log(`      ${i + 1}. ${id}`));

    return true;

  } catch (error) {
    console.error('   ❌ Error reading file:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkExistingData() {
  console.log('\n4️⃣  Checking for existing Goldsky data...');

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as count,
          COUNT(DISTINCT condition_id) as unique_ids
        FROM default.resolutions_external_ingest
        WHERE source = 'goldsky-api'
        FORMAT JSONEachRow
      `,
    });

    const data = await result.json<{ count: string; unique_ids: string }>();

    if (data.length > 0) {
      const count = parseInt(data[0].count);
      const uniqueIds = parseInt(data[0].unique_ids);

      if (count > 0) {
        console.log(`   ⚠️  Found existing Goldsky data:`);
        console.log(`      Total rows: ${count.toLocaleString()}`);
        console.log(`      Unique IDs: ${uniqueIds.toLocaleString()}`);
        console.log('\n   Note: ReplacingMergeTree will deduplicate automatically');
        console.log('         Existing payouts will be updated if re-fetched');
        return true;
      }
    }

    console.log('   ✅ No existing Goldsky data (clean start)');
    return true;

  } catch (error) {
    console.error('   ❌ Error checking data:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkRuntimeDirectory() {
  console.log('\n5️⃣  Checking runtime directory...');

  const runtimeDir = resolve(process.cwd(), 'runtime');

  try {
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true });
      console.log('   ✅ Created runtime directory');
    } else {
      console.log('   ✅ Runtime directory exists');

      // Check for existing checkpoints
      const checkpoints = fs.readdirSync(runtimeDir).filter(f => f.includes('payout-backfill-worker'));

      if (checkpoints.length > 0) {
        console.log(`\n   ⚠️  Found ${checkpoints.length} existing checkpoint/log files:`);
        checkpoints.forEach(f => console.log(`      ${f}`));
        console.log('\n   Workers will resume from checkpoints if restarted');
        console.log('   To start fresh, delete these files');
      }
    }

    return true;
  } catch (error) {
    console.error('   ❌ Error with runtime directory:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function estimateBackfillTime() {
  console.log('\n6️⃣  Estimating backfill time...');

  const filePath = resolve(process.cwd(), 'reports/condition_ids_missing_api.txt');
  const content = fs.readFileSync(filePath, 'utf8');
  const totalIds = content.trim().split('\n').length;

  // Assumptions:
  // - 1000 IDs per batch
  // - 8 concurrent requests per worker
  // - 500ms per request (rate limited)
  // - 4 workers

  const BATCH_SIZE = 1000;
  const CONCURRENT = 8;
  const RATE_LIMIT_MS = 500;
  const WORKERS = 4;

  const totalBatches = Math.ceil(totalIds / BATCH_SIZE);
  const batchesPerWorker = Math.ceil(totalBatches / WORKERS);
  const roundsPerWorker = Math.ceil(batchesPerWorker / CONCURRENT);
  const timePerRoundMs = CONCURRENT * RATE_LIMIT_MS;
  const totalTimeMs = roundsPerWorker * timePerRoundMs;
  const totalMinutes = totalTimeMs / 1000 / 60;

  console.log('\n   📊 Estimate (with 4 workers):');
  console.log(`      Total IDs: ${totalIds.toLocaleString()}`);
  console.log(`      Total batches: ${totalBatches.toLocaleString()}`);
  console.log(`      Batches per worker: ${batchesPerWorker.toLocaleString()}`);
  console.log(`      Concurrent requests: ${CONCURRENT}`);
  console.log(`      Estimated time: ${totalMinutes.toFixed(0)} minutes (${(totalMinutes / 60).toFixed(1)} hours)`);

  console.log('\n   ⚡ Performance tips:');
  console.log('      - Run 8 workers: ~1 hour');
  console.log('      - Run 4 workers: ~2 hours (recommended)');
  console.log('      - Run 2 workers: ~4 hours');

  return true;
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('PAYOUT BACKFILL READINESS CHECK');
  console.log('='.repeat(80));

  const checks = {
    connection: false,
    table: false,
    inputFile: false,
    existingData: false,
    runtime: false,
    estimate: false,
  };

  checks.connection = await checkClickHouseConnection();
  checks.table = await checkTableSchema();
  checks.inputFile = await checkInputFile();
  checks.existingData = await checkExistingData();
  checks.runtime = await checkRuntimeDirectory();
  checks.estimate = await estimateBackfillTime();

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80) + '\n');

  console.log(`ClickHouse connection:  ${checks.connection ? '✅' : '❌'}`);
  console.log(`Table schema:           ${checks.table ? '✅' : '❌'}`);
  console.log(`Input file:             ${checks.inputFile ? '✅' : '❌'}`);
  console.log(`Existing data check:    ${checks.existingData ? '✅' : '❌'}`);
  console.log(`Runtime directory:      ${checks.runtime ? '✅' : '❌'}`);

  const allPassed = Object.values(checks).every(c => c);

  if (allPassed) {
    console.log('\n✅ ALL CHECKS PASSED - Ready to backfill!\n');
    console.log('Next steps:\n');
    console.log('1. Test Goldsky client:');
    console.log('   npx tsx test-goldsky-payouts.ts\n');
    console.log('2. Read execution guide:');
    console.log('   cat BACKFILL_PAYOUTS_GUIDE.md\n');
    console.log('3. Start 4 workers (in separate terminals):');
    console.log('   npx tsx backfill-payouts-parallel.ts --worker=1 --of=4');
    console.log('   npx tsx backfill-payouts-parallel.ts --worker=2 --of=4');
    console.log('   npx tsx backfill-payouts-parallel.ts --worker=3 --of=4');
    console.log('   npx tsx backfill-payouts-parallel.ts --worker=4 --of=4\n');
  } else {
    console.log('\n❌ SOME CHECKS FAILED - Please fix issues before proceeding\n');
    process.exit(1);
  }
}

main().catch(console.error);
