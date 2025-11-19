import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BLOAT_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function retryInserts() {
  console.log('Retrying INSERT operations for blacklist and decisions...\n');

  // Insert into blacklist
  console.log('1. Inserting into wallet_identity_blacklist...\n');

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
    await clickhouse.query({ query: blacklistInsert });
    console.log('  ✅ Blacklist INSERT executed\n');

    // Immediate verification
    const verifyQuery = `
      SELECT * FROM wallet_identity_blacklist
      WHERE executor_wallet = '${BLOAT_EXECUTOR}'
    `;

    const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json();

    console.log(`  Verification: ${verifyData.length} rows found`);
    if (verifyData.length > 0) {
      console.log(`    Executor: ${verifyData[0].executor_wallet}`);
      console.log(`    Reason: ${verifyData[0].reason}`);
      console.log(`    Blacklisted at: ${verifyData[0].blacklisted_at}`);
    }
    console.log();
  } catch (err) {
    console.log(`  ❌ Error inserting into blacklist: ${err.message}\n`);
  }

  // Insert into decisions
  console.log('2. Inserting into wallet_clustering_decisions...\n');

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
    await clickhouse.query({ query: decisionInsert });
    console.log('  ✅ Decision INSERT executed\n');

    // Immediate verification
    const verifyQuery = `
      SELECT * FROM wallet_clustering_decisions
      WHERE canonical_wallet = '${XCN_CANONICAL}'
    `;

    const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json();

    console.log(`  Verification: ${verifyData.length} rows found`);
    if (verifyData.length > 0) {
      console.log(`    Canonical wallet: ${verifyData[0].canonical_wallet}`);
      console.log(`    Decision: ${verifyData[0].decision}`);
      console.log(`    Decided at: ${verifyData[0].decided_at}`);
      console.log(`    Evidence: ${verifyData[0].evidence.substring(0, 100)}...`);
    }
    console.log();
  } catch (err) {
    console.log(`  ❌ Error inserting into decisions: ${err.message}\n`);
  }

  // Final verification - check both tables
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FINAL VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  const blacklistCount = await clickhouse.query({
    query: `SELECT count() AS cnt FROM wallet_identity_blacklist WHERE executor_wallet = '${BLOAT_EXECUTOR}'`,
    format: 'JSONEachRow'
  });
  const blacklistData = await blacklistCount.json();

  const decisionCount = await clickhouse.query({
    query: `SELECT count() AS cnt FROM wallet_clustering_decisions WHERE canonical_wallet = '${XCN_CANONICAL}'`,
    format: 'JSONEachRow'
  });
  const decisionData = await decisionCount.json();

  console.log(`Blacklist entries: ${blacklistData[0].cnt}`);
  console.log(`Decision entries: ${decisionData[0].cnt}\n`);

  if (blacklistData[0].cnt > 0 && decisionData[0].cnt > 0) {
    console.log('✅ ALL INSERTS SUCCESSFUL\n');
  } else {
    console.log('⚠️  Some inserts failed or are still materializing\n');
  }
}

retryInserts()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
