import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BLOAT_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function simpleInsertWithFinal() {
  console.log('Simple INSERT test with FINAL queries...\n');

  // Clear any existing data first (in case of duplicates)
  console.log('1. Checking for existing data...\n');

  // Check with FINAL modifier
  const blacklistCheckFinal = `
    SELECT * FROM wallet_identity_blacklist FINAL
    WHERE executor_wallet = '${BLOAT_EXECUTOR}'
  `;

  const checkResult = await clickhouse.query({ query: blacklistCheckFinal, format: 'JSONEachRow' });
  const checkData = await checkResult.json();

  console.log(`  Existing blacklist entries (FINAL): ${checkData.length}\n`);

  // Simple INSERT
  console.log('2. Simple INSERT statements...\n');

  // Blacklist insert
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const blacklistInsert = `
      INSERT INTO wallet_identity_blacklist (executor_wallet, reason, blacklisted_at, blacklisted_by)
      VALUES (
        '${BLOAT_EXECUTOR}',
        'XCN bloat executor - contributed $2.58B volume (1,290x blowup in progressive analysis)',
        '${timestamp}',
        'C3-PnL-Agent'
      )
    `;

    await clickhouse.query({ query: blacklistInsert });
    console.log(`  ✅ Blacklist INSERT completed (timestamp: ${timestamp})\n`);
  } catch (err) {
    console.log(`  ❌ Blacklist INSERT error: ${err.message}\n`);
  }

  // Decision insert
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const decisionInsert = `
      INSERT INTO wallet_clustering_decisions (canonical_wallet, decision, evidence, decided_at, decided_by)
      VALUES (
        '${XCN_CANONICAL}',
        'base_only',
        'Progressive analysis 2025-11-17: All 12 executors cause 100x+ volume blowup. Target: \\$1.5M / +\\$80k. Base: \\$20k / -\\$20k. First executor jumps to \\$2.58B. No valid executor configuration found.',
        '${timestamp}',
        'C3-PnL-Agent'
      )
    `;

    await clickhouse.query({ query: decisionInsert });
    console.log(`  ✅ Decision INSERT completed (timestamp: ${timestamp})\n`);
  } catch (err) {
    console.log(`  ❌ Decision INSERT error: ${err.message}\n`);
  }

  // Wait for data to settle
  console.log('Waiting 2 seconds...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verify with different query methods
  console.log('3. Verification with different query methods...\n');

  // a) Without FINAL
  console.log('  a) SELECT without FINAL:\n');

  const blacklistNoFinal = `SELECT * FROM wallet_identity_blacklist WHERE executor_wallet = '${BLOAT_EXECUTOR}'`;
  const noFinalResult = await clickhouse.query({ query: blacklistNoFinal, format: 'JSONEachRow' });
  const noFinalData = await noFinalResult.json();
  console.log(`     Blacklist rows: ${noFinalData.length}`);

  const decisionNoFinal = `SELECT * FROM wallet_clustering_decisions WHERE canonical_wallet = '${XCN_CANONICAL}'`;
  const decNoFinalResult = await clickhouse.query({ query: decisionNoFinal, format: 'JSONEachRow' });
  const decNoFinalData = await decNoFinalResult.json();
  console.log(`     Decision rows: ${decNoFinalData.length}\n`);

  // b) With FINAL
  console.log('  b) SELECT with FINAL:\n');

  const blacklistFinal = `SELECT * FROM wallet_identity_blacklist FINAL WHERE executor_wallet = '${BLOAT_EXECUTOR}'`;
  const finalResult = await clickhouse.query({ query: blacklistFinal, format: 'JSONEachRow' });
  const finalData = await finalResult.json();
  console.log(`     Blacklist rows: ${finalData.length}`);
  if (finalData.length > 0) {
    console.log(`       - ${finalData[0].executor_wallet}`);
    console.log(`       - ${finalData[0].reason.substring(0, 60)}...`);
    console.log(`       - ${finalData[0].blacklisted_at}`);
  }

  const decisionFinal = `SELECT * FROM wallet_clustering_decisions FINAL WHERE canonical_wallet = '${XCN_CANONICAL}'`;
  const decFinalResult = await clickhouse.query({ query: decisionFinal, format: 'JSONEachRow' });
  const decFinalData = await decFinalResult.json();
  console.log(`     Decision rows: ${decFinalData.length}`);
  if (decFinalData.length > 0) {
    console.log(`       - ${decFinalData[0].canonical_wallet}`);
    console.log(`       - ${decFinalData[0].decision}`);
    console.log(`       - ${decFinalData[0].decided_at}`);
  }
  console.log();

  // c) Count all rows in tables
  console.log('  c) Total rows in tables:\n');

  const blacklistCount = await clickhouse.query({
    query: 'SELECT count() AS cnt FROM wallet_identity_blacklist',
    format: 'JSONEachRow'
  });
  const blacklistCntData = await blacklistCount.json();
  console.log(`     wallet_identity_blacklist: ${blacklistCntData[0].cnt} rows`);

  const decisionCount = await clickhouse.query({
    query: 'SELECT count() AS cnt FROM wallet_clustering_decisions',
    format: 'JSONEachRow'
  });
  const decisionCntData = await decisionCount.json();
  console.log(`     wallet_clustering_decisions: ${decisionCntData[0].cnt} rows\n`);

  // Final summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('RESULT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (finalData.length > 0 && decFinalData.length > 0) {
    console.log('✅ SUCCESS - Data inserted and visible with FINAL\n');
  } else if (noFinalData.length > 0 || decNoFinalData.length > 0) {
    console.log('⚠️  PARTIAL - Data inserted but needs FINAL to query\n');
  } else {
    console.log('❌ FAILED - Data still not visible\n');
    console.log('Possible issues:');
    console.log('  - ClickHouse Cloud async replication lag');
    console.log('  - Permission issues with these tables');
    console.log('  - Table engine configuration issue\n');
  }
}

simpleInsertWithFinal()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
