import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BLOAT_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function executeOverrideUpdates() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET OVERRIDE UPDATES');
  console.log('═══════════════════════════════════════════════════════════\n');

  // STEP 1: Count existing overrides
  console.log('STEP 1: Checking existing overrides...\n');

  const countQuery = `
    SELECT count() AS override_count
    FROM wallet_identity_overrides
    WHERE canonical_wallet = '${XCN_CANONICAL}'
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = await countResult.json();

  if (countData.length > 0) {
    console.log(`  Found ${countData[0].override_count} existing overrides for XCN wallet\n`);
  }

  // STEP 2: Delete all XCN overrides
  console.log('STEP 2: Removing all XCN executor overrides...\n');

  const deleteQuery = `
    ALTER TABLE wallet_identity_overrides
    DELETE WHERE canonical_wallet = '${XCN_CANONICAL}'
  `;

  try {
    await clickhouse.query({ query: deleteQuery });
    console.log('  ✅ Deleted all XCN executor overrides\n');
  } catch (err) {
    console.log(`  ⚠️  Error deleting overrides: ${err.message}\n`);
  }

  // Wait for mutation to complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verify deletion
  const verifyDeleteResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const verifyDeleteData = await verifyDeleteResult.json();

  if (verifyDeleteData.length > 0) {
    console.log(`  Remaining overrides: ${verifyDeleteData[0].override_count}\n`);
    if (verifyDeleteData[0].override_count === 0) {
      console.log('  ✅ All overrides successfully removed\n');
    } else {
      console.log('  ⚠️  Some overrides remain (mutations may be pending)\n');
    }
  }

  // STEP 3: Create blacklist table if not exists
  console.log('STEP 3: Setting up blacklist table...\n');

  const createBlacklistQuery = `
    CREATE TABLE IF NOT EXISTS wallet_identity_blacklist (
      executor_wallet String,
      reason String,
      blacklisted_at DateTime DEFAULT now(),
      blacklisted_by String DEFAULT 'C3-PnL-Agent'
    ) ENGINE = ReplacingMergeTree()
    ORDER BY (executor_wallet, blacklisted_at)
  `;

  try {
    await clickhouse.query({ query: createBlacklistQuery });
    console.log('  ✅ Blacklist table ready\n');
  } catch (err) {
    console.log(`  ⚠️  Error creating blacklist table: ${err.message}\n`);
  }

  // STEP 4: Add bloat executor to blacklist
  console.log('STEP 4: Blacklisting bloat executor...\n');

  const blacklistQuery = `
    INSERT INTO wallet_identity_blacklist (executor_wallet, reason, blacklisted_at)
    VALUES (
      '${BLOAT_EXECUTOR}',
      'XCN bloat executor - contributed $2.58B volume (1,290x blowup in progressive analysis)',
      now()
    )
  `;

  try {
    await clickhouse.query({ query: blacklistQuery });
    console.log(`  ✅ Blacklisted executor: ${BLOAT_EXECUTOR}\n`);
  } catch (err) {
    console.log(`  ⚠️  Error blacklisting executor: ${err.message}\n`);
  }

  // STEP 5: Create decisions table if not exists
  console.log('STEP 5: Setting up decisions table...\n');

  const createDecisionsQuery = `
    CREATE TABLE IF NOT EXISTS wallet_clustering_decisions (
      canonical_wallet String,
      decision Enum8('base_only' = 0, 'clustered' = 1, 'pending_review' = 2),
      evidence String,
      decided_at DateTime DEFAULT now(),
      decided_by String DEFAULT 'C3-PnL-Agent'
    ) ENGINE = ReplacingMergeTree()
    ORDER BY (canonical_wallet, decided_at)
  `;

  try {
    await clickhouse.query({ query: createDecisionsQuery });
    console.log('  ✅ Decisions table ready\n');
  } catch (err) {
    console.log(`  ⚠️  Error creating decisions table: ${err.message}\n`);
  }

  // STEP 6: Document decision
  console.log('STEP 6: Documenting clustering decision...\n');

  const decisionQuery = `
    INSERT INTO wallet_clustering_decisions (canonical_wallet, decision, evidence, decided_at)
    VALUES (
      '${XCN_CANONICAL}',
      'base_only',
      'Progressive analysis 2025-11-17: All 12 executors cause 100x+ volume blowup. Target: $1.5M / +$80k. Base: $20k / -$20k. First executor jumps to $2.58B. No valid executor configuration found.',
      now()
    )
  `;

  try {
    await clickhouse.query({ query: decisionQuery });
    console.log('  ✅ Decision documented\n');
  } catch (err) {
    console.log(`  ⚠️  Error documenting decision: ${err.message}\n`);
  }

  // STEP 7: Verification
  console.log('═══════════════════════════════════════════════════════════');
  console.log('VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check overrides
  const finalCountResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const finalCountData = await finalCountResult.json();

  console.log(`XCN Overrides: ${finalCountData[0].override_count}`);
  if (finalCountData[0].override_count === 0) {
    console.log('  ✅ PASS - No executors\n');
  } else {
    console.log('  ❌ FAIL - Overrides still exist\n');
  }

  // Check blacklist
  const blacklistCheckQuery = `
    SELECT *
    FROM wallet_identity_blacklist
    WHERE executor_wallet = '${BLOAT_EXECUTOR}'
    ORDER BY blacklisted_at DESC
    LIMIT 1
  `;

  const blacklistCheckResult = await clickhouse.query({ query: blacklistCheckQuery, format: 'JSONEachRow' });
  const blacklistCheckData = await blacklistCheckResult.json();

  console.log(`Blacklist entries: ${blacklistCheckData.length}`);
  if (blacklistCheckData.length > 0) {
    console.log('  ✅ PASS - Bloat executor blacklisted');
    console.log(`  Reason: ${blacklistCheckData[0].reason}\n`);
  } else {
    console.log('  ❌ FAIL - Bloat executor not in blacklist\n');
  }

  // Check decision
  const decisionCheckQuery = `
    SELECT *
    FROM wallet_clustering_decisions
    WHERE canonical_wallet = '${XCN_CANONICAL}'
    ORDER BY decided_at DESC
    LIMIT 1
  `;

  const decisionCheckResult = await clickhouse.query({ query: decisionCheckQuery, format: 'JSONEachRow' });
  const decisionCheckData = await decisionCheckResult.json();

  console.log(`Decision entries: ${decisionCheckData.length}`);
  if (decisionCheckData.length > 0) {
    console.log('  ✅ PASS - Decision documented');
    console.log(`  Decision: ${decisionCheckData[0].decision}`);
    console.log(`  Evidence: ${decisionCheckData[0].evidence.substring(0, 100)}...\n`);
  } else {
    console.log('  ❌ FAIL - Decision not documented\n');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('UPDATE COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Summary:');
  console.log(`  XCN wallet: Base only (0 executors)`);
  console.log(`  Bloat executor: Blacklisted (${BLOAT_EXECUTOR})`);
  console.log(`  Decision: base_only (documented)\n`);
}

executeOverrideUpdates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
