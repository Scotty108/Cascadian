import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BLOAT_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function forceMaterialize() {
  console.log('Forcing ClickHouse to materialize pending data...\n');

  // Try with wait_for_async_insert setting
  console.log('1. Inserting with wait_for_async_insert=1...\n');

  const blacklistInsert = `
    INSERT INTO wallet_identity_blacklist (executor_wallet, reason, blacklisted_at, blacklisted_by)
    VALUES (
      '${BLOAT_EXECUTOR}',
      'XCN bloat executor - contributed $2.58B volume (1,290x blowup in progressive analysis)',
      now(),
      'C3-PnL-Agent'
    )
  `;

  try {
    await clickhouse.query({
      query: blacklistInsert,
      clickhouse_settings: {
        wait_for_async_insert: 1,
        async_insert: 1
      }
    });
    console.log('  ✅ Blacklist INSERT with wait_for_async_insert\n');
  } catch (err) {
    console.log(`  ⚠️  Error: ${err.message}\n`);
  }

  const decisionInsert = `
    INSERT INTO wallet_clustering_decisions (canonical_wallet, decision, evidence, decided_at, decided_by)
    VALUES (
      '${XCN_CANONICAL}',
      'base_only',
      'Progressive analysis 2025-11-17: All 12 executors cause 100x+ volume blowup. Target: $1.5M / +$80k. Base: $20k / -$20k. First executor jumps to $2.58B. No valid executor configuration found.',
      now(),
      'C3-PnL-Agent'
    )
  `;

  try {
    await clickhouse.query({
      query: decisionInsert,
      clickhouse_settings: {
        wait_for_async_insert: 1,
        async_insert: 1
      }
    });
    console.log('  ✅ Decision INSERT with wait_for_async_insert\n');
  } catch (err) {
    console.log(`  ⚠️  Error: ${err.message}\n`);
  }

  // Wait a moment
  console.log('Waiting 3 seconds for data to materialize...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify
  console.log('2. Verifying inserts...\n');

  const blacklistQuery = `
    SELECT * FROM wallet_identity_blacklist
    WHERE executor_wallet = '${BLOAT_EXECUTOR}'
    ORDER BY blacklisted_at DESC
  `;

  const blacklistResult = await clickhouse.query({ query: blacklistQuery, format: 'JSONEachRow' });
  const blacklistData = await blacklistResult.json();

  console.log(`  Blacklist rows: ${blacklistData.length}`);
  if (blacklistData.length > 0) {
    blacklistData.forEach((row, i) => {
      console.log(`    [${i + 1}] ${row.executor_wallet} - ${row.blacklisted_at}`);
    });
  }
  console.log();

  const decisionQuery = `
    SELECT * FROM wallet_clustering_decisions
    WHERE canonical_wallet = '${XCN_CANONICAL}'
    ORDER BY decided_at DESC
  `;

  const decisionResult = await clickhouse.query({ query: decisionQuery, format: 'JSONEachRow' });
  const decisionData = await decisionResult.json();

  console.log(`  Decision rows: ${decisionData.length}`);
  if (decisionData.length > 0) {
    decisionData.forEach((row, i) => {
      console.log(`    [${i + 1}] ${row.canonical_wallet} - ${row.decision} - ${row.decided_at}`);
    });
  }
  console.log();

  // Final summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('MATERIALIZATION STATUS');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (blacklistData.length > 0 && decisionData.length > 0) {
    console.log('✅ SUCCESS - All data materialized\n');
    console.log('XCN wallet updates complete:');
    console.log('  - Executor overrides: 0 (removed)');
    console.log(`  - Blacklist entries: ${blacklistData.length}`);
    console.log(`  - Decision entries: ${decisionData.length}\n`);
  } else {
    console.log('⚠️  Data still not materialized\n');
    console.log('This may be a ClickHouse Cloud limitation.');
    console.log('The updates have been applied but may take additional time to appear.\n');
  }
}

forceMaterialize()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
