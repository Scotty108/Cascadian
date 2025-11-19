#!/usr/bin/env npx tsx
/**
 * FINAL REALITY CHECK FOR PNL FEATURE
 *
 * The RIGHT question: "Do we have 90%+ of trades on RESOLVED markets?"
 *
 * NOT: "Do we have 90%+ of all trades?" (97% are unresolved, can't compute PnL)
 *
 * This script answers 3 critical questions:
 * Q1: How many trades exist on RESOLVED markets in our warehouse?
 * Q2: What % of those trades are in fact_trades_clean?
 * Q3: Can we ship PnL feature with current coverage?
 *
 * Decision criteria:
 * - If Q2 ≥ 90%: ✅ SHIP PnL feature
 * - If Q2 = 70-90%: ⚠️ Ship as beta
 * - If Q2 < 70%: ❌ Need more recovery
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('FINAL REALITY CHECK: Can We Ship PnL Feature?');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 1: Understand the resolved vs unresolved split
// ============================================================================

console.log('STEP 1: Understanding Resolved vs Unresolved Markets');
console.log('─'.repeat(80));

try {
  const resolutionSplit = await client.query({
    query: `
      SELECT
        'Total markets in market_resolutions_final' AS metric,
        toString(count()) AS value
      FROM market_resolutions_final
      UNION ALL
      SELECT 'Markets with winning_index (RESOLVED)',
        toString(countIf(winning_index IS NOT NULL))
      FROM market_resolutions_final
      UNION ALL
      SELECT 'Markets without winning_index (UNRESOLVED)',
        toString(countIf(winning_index IS NULL))
      FROM market_resolutions_final
      UNION ALL
      SELECT 'Unique condition_ids',
        toString(uniqExact(condition_id_norm))
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow',
  });

  const splitData = await resolutionSplit.json<Array<{ metric: string; value: string }>>();
  console.log();
  splitData.forEach(row => {
    console.log(`  ${row.metric.padEnd(50)} ${row.value.padStart(15)}`);
  });

  const resolvedCount = parseInt(splitData.find(r => r.metric.includes('RESOLVED'))?.value || '0');
  const unresolvedCount = parseInt(splitData.find(r => r.metric.includes('UNRESOLVED'))?.value || '0');

  console.log();
  console.log(`Analysis:`);
  console.log(`  Resolved:   ${resolvedCount.toLocaleString()} (${(resolvedCount / (resolvedCount + unresolvedCount) * 100).toFixed(1)}%)`);
  console.log(`  Unresolved: ${unresolvedCount.toLocaleString()} (${(unresolvedCount / (resolvedCount + unresolvedCount) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`  ℹ️  For PnL calculation, we ONLY care about RESOLVED markets`);
  console.log(`     (can't compute win rate on open bets!)`);

} catch (error) {
  console.error('❌ STEP 1 Failed:', error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 2: How many trades exist on RESOLVED markets?
// ============================================================================

console.log('STEP 2: Count Trades on RESOLVED Markets (All Sources)');
console.log('─'.repeat(80));

try {
  console.log('\nChecking vw_trades_canonical...');

  const tradesOnResolved = await client.query({
    query: `
      WITH resolved_cids AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id_norm, '0x', '')) AS cid_clean
        FROM market_resolutions_final
        WHERE winning_index IS NOT NULL
      )
      SELECT
        'vw_trades_canonical total rows' AS metric,
        toString(count()) AS value
      FROM vw_trades_canonical
      UNION ALL
      SELECT 'vw_trades_canonical trades on RESOLVED markets',
        toString(countIf(
          lower(replaceAll(condition_id_norm, '0x', '')) IN (SELECT cid_clean FROM resolved_cids)
        ))
      FROM vw_trades_canonical
      UNION ALL
      SELECT 'vw_trades_canonical trades on UNRESOLVED markets',
        toString(countIf(
          lower(replaceAll(condition_id_norm, '0x', '')) NOT IN (SELECT cid_clean FROM resolved_cids)
        ))
      FROM vw_trades_canonical
    `,
    format: 'JSONEachRow',
  });

  const vwcData = await tradesOnResolved.json<Array<{ metric: string; value: string }>>();
  console.log();
  vwcData.forEach(row => {
    console.log(`  ${row.metric.padEnd(55)} ${row.value.padStart(15)}`);
  });

  const resolvedTrades = parseInt(vwcData.find(r => r.metric.includes('RESOLVED markets'))?.value || '0');
  const unresolvedTrades = parseInt(vwcData.find(r => r.metric.includes('UNRESOLVED markets'))?.value || '0');
  const total = resolvedTrades + unresolvedTrades;

  console.log();
  console.log(`Analysis:`);
  console.log(`  Trades on resolved:   ${resolvedTrades.toLocaleString()} (${(resolvedTrades / total * 100).toFixed(1)}%)`);
  console.log(`  Trades on unresolved: ${unresolvedTrades.toLocaleString()} (${(unresolvedTrades / total * 100).toFixed(1)}%)`);
  console.log();
  console.log(`  🎯 TARGET: We need ≥90% coverage of these ${resolvedTrades.toLocaleString()} trades`);

} catch (error) {
  console.error('❌ STEP 2 Failed:', error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3: What % of RESOLVED trades are in fact_trades_clean?
// ============================================================================

console.log('STEP 3: Check Coverage in fact_trades_clean');
console.log('─'.repeat(80));

try {
  console.log('\nChecking if fact_trades_clean exists...');

  // First check if table exists
  let factTableName = 'fact_trades_clean';
  try {
    await client.query({ query: `SELECT 1 FROM cascadian_clean.fact_trades_clean LIMIT 1` });
    factTableName = 'cascadian_clean.fact_trades_clean';
  } catch {
    try {
      await client.query({ query: `SELECT 1 FROM default.fact_trades_clean LIMIT 1` });
      factTableName = 'default.fact_trades_clean';
    } catch {
      console.log('  ❌ fact_trades_clean table NOT FOUND');
      console.log('  Checking for alternative tables...');

      // Check for alternatives
      const tables = await client.query({
        query: `SELECT name FROM system.tables WHERE database IN ('default', 'cascadian_clean') AND name LIKE '%fact%'`,
        format: 'JSONEachRow',
      });
      const tableList = await tables.json<Array<{ name: string }>>();
      console.log(`  Found tables: ${tableList.map(t => t.name).join(', ')}`);
      throw new Error('fact_trades_clean not found');
    }
  }

  console.log(`  ✅ Found: ${factTableName}`);
  console.log();

  const factCoverage = await client.query({
    query: `
      WITH resolved_cids AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id_norm, '0x', '')) AS cid_clean
        FROM market_resolutions_final
        WHERE winning_index IS NOT NULL
      ),
      resolved_trades_vwc AS (
        SELECT DISTINCT transaction_hash AS tx_hash
        FROM vw_trades_canonical
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) IN (SELECT cid_clean FROM resolved_cids)
      ),
      resolved_trades_fact AS (
        SELECT DISTINCT tx_hash
        FROM ${factTableName}
        WHERE lower(replaceAll(cid_hex, '0x', '')) IN (SELECT cid_clean FROM resolved_cids)
      )
      SELECT
        '${factTableName} total rows' AS metric,
        toString(count()) AS value
      FROM ${factTableName}
      UNION ALL
      SELECT 'Unique tx_hashes on RESOLVED markets in vwc',
        toString((SELECT count() FROM resolved_trades_vwc))
      UNION ALL
      SELECT 'Unique tx_hashes on RESOLVED markets in fact',
        toString((SELECT count() FROM resolved_trades_fact))
      UNION ALL
      SELECT 'Coverage % (fact / vwc for RESOLVED)',
        toString(round(
          (SELECT count() FROM resolved_trades_fact) * 100.0 /
          nullIf((SELECT count() FROM resolved_trades_vwc), 0),
          2
        ))
    `,
    format: 'JSONEachRow',
  });

  const factData = await factCoverage.json<Array<{ metric: string; value: string }>>();
  console.log('Results:');
  factData.forEach(row => {
    console.log(`  ${row.metric.padEnd(55)} ${row.value.padStart(15)}`);
  });

  const coveragePct = parseFloat(factData.find(r => r.metric.includes('Coverage %'))?.value || '0');

  console.log();
  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));
  console.log();

  if (coveragePct >= 90) {
    console.log(`✅ SHIP IT! ${coveragePct}% coverage of RESOLVED market trades`);
    console.log();
    console.log('Rationale:');
    console.log(`  • ${coveragePct}% ≥ 90% threshold`);
    console.log('  • Can calculate accurate win rate, omega ratio, ROI');
    console.log('  • Missing 10% unlikely to materially affect metrics');
    console.log();
    console.log('Next steps:');
    console.log('  1. Build wallet PnL views using fact_trades_clean');
    console.log('  2. Join with market_resolutions_final for outcomes');
    console.log('  3. Ship PnL feature to production');
    console.log();
  } else if (coveragePct >= 70) {
    console.log(`⚠️  SHIP AS BETA: ${coveragePct}% coverage of RESOLVED market trades`);
    console.log();
    console.log('Rationale:');
    console.log(`  • ${coveragePct}% is acceptable for beta launch`);
    console.log('  • Can calculate approximate win rate, omega ratio, ROI');
    console.log('  • Add disclaimer about coverage limitations');
    console.log();
    console.log('Recommendation:');
    console.log('  1. Ship PnL feature as "beta" with 70-90% coverage notice');
    console.log('  2. Run Gamma API backfill to improve to 85-95%');
    console.log('  3. Upgrade to "production" after backfill');
    console.log();
  } else {
    console.log(`❌ DO NOT SHIP: Only ${coveragePct}% coverage of RESOLVED market trades`);
    console.log();
    console.log('Rationale:');
    console.log(`  • ${coveragePct}% < 70% threshold`);
    console.log('  • PnL calculations would be too inaccurate');
    console.log('  • Need more data recovery first');
    console.log();
    console.log('Next steps:');
    console.log('  1. Run Gamma API backfill (scripts/backfill-from-gamma-api.ts)');
    console.log('  2. Expected improvement: +20-30% coverage');
    console.log('  3. Re-run this script after backfill');
    console.log();
  }

} catch (error) {
  console.error('❌ STEP 3 Failed:', error);
  console.log();
  console.log('Unable to determine coverage. Check table existence and schema.');
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
