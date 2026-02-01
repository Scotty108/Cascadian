#!/usr/bin/env npx tsx
/**
 * Compare Old and New Unified Tables
 *
 * Compares pm_trade_fifo_roi_v3_mat_unified (old) vs pm_trade_fifo_roi_v3_mat_unified_v2 (new)
 * to verify data integrity before swapping tables.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const OLD_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';
const NEW_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_v2';

async function compareTables() {
  console.log('🔍 Comparing Unified Tables\n');
  console.log(`OLD: ${OLD_TABLE}`);
  console.log(`NEW: ${NEW_TABLE}\n`);

  // Basic stats comparison
  console.log('📊 BASIC STATS COMPARISON\n');

  const statsResult = await clickhouse.query({
    query: `
      SELECT
        '${OLD_TABLE}' as table_name,
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NULL) as unresolved_rows,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        countIf(is_short = 1) as short_positions,
        countIf(is_closed = 1) as closed_positions
      FROM ${OLD_TABLE}

      UNION ALL

      SELECT
        '${NEW_TABLE}' as table_name,
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NULL) as unresolved_rows,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        countIf(is_short = 1) as short_positions,
        countIf(is_closed = 1) as closed_positions
      FROM ${NEW_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const stats = await statsResult.json<any>();

  console.log('Table                              | Rows       | Wallets  | Unresolved | Resolved   | Shorts    | Closed');
  console.log('-----------------------------------|------------|----------|------------|------------|-----------|----------');
  stats.forEach((s: any) => {
    const name = s.table_name.padEnd(34);
    const rows = parseInt(s.total_rows).toLocaleString().padStart(10);
    const wallets = parseInt(s.unique_wallets).toLocaleString().padStart(8);
    const unres = parseInt(s.unresolved_rows).toLocaleString().padStart(10);
    const res = parseInt(s.resolved_rows).toLocaleString().padStart(10);
    const shorts = parseInt(s.short_positions).toLocaleString().padStart(9);
    const closed = parseInt(s.closed_positions).toLocaleString().padStart(9);
    console.log(`${name} | ${rows} | ${wallets} | ${unres} | ${res} | ${shorts} | ${closed}`);
  });
  console.log('\n');

  // Freshness comparison
  console.log('⏰ FRESHNESS COMPARISON\n');

  const freshnessResult = await clickhouse.query({
    query: `
      SELECT
        '${OLD_TABLE}' as table_name,
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as unresolved_stale_min,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as resolved_stale_min
      FROM ${OLD_TABLE}

      UNION ALL

      SELECT
        '${NEW_TABLE}' as table_name,
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as unresolved_stale_min,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as resolved_stale_min
      FROM ${NEW_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const freshness = await freshnessResult.json<any>();

  console.log('Table                              | Newest Unresolved   | Stale (min) | Newest Resolved     | Stale (min)');
  console.log('-----------------------------------|---------------------|-------------|---------------------|------------');
  freshness.forEach((f: any) => {
    const name = f.table_name.padEnd(34);
    const unres = (f.newest_unresolved || 'N/A').padEnd(19);
    const unresSt = (f.unresolved_stale_min?.toString() || 'N/A').padStart(11);
    const res = (f.newest_resolved || 'N/A').padEnd(19);
    const resSt = (f.resolved_stale_min?.toString() || 'N/A').padStart(11);
    console.log(`${name} | ${unres} | ${unresSt} | ${res} | ${resSt}`);
  });
  console.log('\n');

  // Wallet overlap check (sample)
  console.log('👥 WALLET OVERLAP CHECK (Top 100 wallets)\n');

  const overlapResult = await clickhouse.query({
    query: `
      WITH old_wallets AS (
        SELECT DISTINCT wallet
        FROM ${OLD_TABLE}
        WHERE resolved_at IS NOT NULL
        ORDER BY wallet
        LIMIT 100
      ),
      new_wallets AS (
        SELECT DISTINCT wallet
        FROM ${NEW_TABLE}
        WHERE resolved_at IS NOT NULL
        ORDER BY wallet
        LIMIT 100
      )
      SELECT
        (SELECT count() FROM old_wallets) as old_count,
        (SELECT count() FROM new_wallets) as new_count,
        (SELECT count() FROM old_wallets WHERE wallet IN (SELECT wallet FROM new_wallets)) as overlap_count
    `,
    format: 'JSONEachRow'
  });
  const overlap = (await overlapResult.json<any>())[0];

  console.log(`   Old table (top 100): ${overlap.old_count} wallets`);
  console.log(`   New table (top 100): ${overlap.new_count} wallets`);
  console.log(`   Overlap: ${overlap.overlap_count} wallets`);
  console.log(`   Match rate: ${(overlap.overlap_count / overlap.old_count * 100).toFixed(1)}%\n`);

  // Resolved data integrity check
  console.log('✅ RESOLVED DATA INTEGRITY CHECK\n');

  const resolvedCheckResult = await clickhouse.query({
    query: `
      SELECT
        countIf(old.wallet IS NOT NULL AND new.wallet IS NULL) as in_old_not_new,
        countIf(old.wallet IS NULL AND new.wallet IS NOT NULL) as in_new_not_old,
        countIf(old.wallet IS NOT NULL AND new.wallet IS NOT NULL) as in_both
      FROM (
        SELECT DISTINCT wallet
        FROM ${OLD_TABLE}
        WHERE resolved_at IS NOT NULL
        LIMIT 1000
      ) AS old
      FULL OUTER JOIN (
        SELECT DISTINCT wallet
        FROM ${NEW_TABLE}
        WHERE resolved_at IS NOT NULL
        LIMIT 1000
      ) AS new
      ON old.wallet = new.wallet
    `,
    format: 'JSONEachRow'
  });
  const resolvedCheck = (await resolvedCheckResult.json<any>())[0];

  console.log(`   Sample: 1000 wallets with resolved positions`);
  console.log(`   In old but not new: ${resolvedCheck.in_old_not_new} ⚠️`);
  console.log(`   In new but not old: ${resolvedCheck.in_new_not_old}`);
  console.log(`   In both: ${resolvedCheck.in_both} ✅\n`);

  // Pending mutations check
  console.log('🔧 PENDING MUTATIONS CHECK\n');

  const mutationsResult = await clickhouse.query({
    query: `
      SELECT
        table,
        count() as pending_mutations,
        min(create_time) as oldest,
        max(create_time) as newest
      FROM system.mutations
      WHERE (table = '${OLD_TABLE}' OR table = '${NEW_TABLE}')
        AND is_done = 0
      GROUP BY table
    `,
    format: 'JSONEachRow'
  });
  const mutations = await mutationsResult.json<any>();

  if (mutations.length === 0) {
    console.log('   ✅ No pending mutations on either table\n');
  } else {
    mutations.forEach((m: any) => {
      console.log(`   ${m.table}:`);
      console.log(`      Pending: ${m.pending_mutations}`);
      console.log(`      Oldest: ${m.oldest}`);
      console.log(`      Newest: ${m.newest}\n`);
    });
  }

  // Final recommendation
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📋 RECOMMENDATION\n');

  const newFreshness = freshness.find((f: any) => f.table_name === NEW_TABLE);
  const oldFreshness = freshness.find((f: any) => f.table_name === OLD_TABLE);

  if (newFreshness.unresolved_stale_min < 60 && newFreshness.resolved_stale_min < 60) {
    console.log('✅ NEW TABLE IS FRESH (<1 hour stale)\n');
    console.log('Safe to swap tables:');
    console.log(`   RENAME TABLE`);
    console.log(`     ${OLD_TABLE} TO ${OLD_TABLE}_backup,`);
    console.log(`     ${NEW_TABLE} TO ${OLD_TABLE};\n`);
  } else {
    console.log('⚠️  NEW TABLE NOT FRESH YET\n');
    console.log(`   Unresolved: ${newFreshness.unresolved_stale_min} minutes stale`);
    console.log(`   Resolved: ${newFreshness.resolved_stale_min} minutes stale\n`);
    console.log('Wait for build to complete before swapping.\n');
  }

  if (resolvedCheck.in_old_not_new > 100) {
    console.log('⚠️  WARNING: Significant data missing in new table');
    console.log(`   ${resolvedCheck.in_old_not_new} wallets in old but not new (sample)`);
    console.log('   Investigate before swapping!\n');
  }
}

compareTables().catch(console.error);
