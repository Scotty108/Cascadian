#!/usr/bin/env npx tsx
/**
 * COMPREHENSIVE RESOLUTION DATA SEARCH
 *
 * Exhaustively search ALL internal tables for the wallet's 30 condition_ids
 * to find payout vectors before resorting to external APIs.
 *
 * Tables to check:
 * - gamma_resolved (123,245 rows)
 * - resolution_candidates (424,095 rows)
 * - staging_resolutions_union (544,475 rows)
 * - market_resolutions_final_backup (137,391 rows)
 * - market_resolutions (137,391 rows)
 * - market_resolutions_by_market (133,895 rows)
 * - market_key_map (156,952 rows)
 * - api_ctf_bridge (156,952 rows - has resolved_outcome)
 * - market_id_mapping (187,071 rows)
 *
 * For each table, check:
 * 1. Do the condition_ids exist?
 * 2. Do they have non-empty payout vectors?
 * 3. What format are outcomes stored in?
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const AUDIT_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function checkTable(
  tableName: string,
  conditionIdColumn: string,
  payoutColumns: string[],
  normalizeId: boolean = true
) {
  try {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`CHECKING: ${tableName}`);
    console.log('═'.repeat(80));

    // Get schema first
    const schema = await ch.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database IN ('default', 'cascadian_clean')
          AND table = '${tableName.split('.').pop()}'
        ORDER BY name
      `,
      format: 'JSONEachRow',
    });
    const schemaData = await schema.json<any[]>();

    console.log(`\nColumns (${schemaData.length} total):`);
    const relevantCols = schemaData.filter(c =>
      c.name.toLowerCase().includes('payout') ||
      c.name.toLowerCase().includes('outcome') ||
      c.name.toLowerCase().includes('winner') ||
      c.name.toLowerCase().includes('resolved') ||
      c.name.toLowerCase().includes('condition')
    );
    relevantCols.forEach(col => {
      console.log(`  - ${col.name}: ${col.type}`);
    });

    // Build the ID normalization
    const idNormalization = normalizeId
      ? `lower(replaceAll(${conditionIdColumn}, '0x', ''))`
      : `toString(${conditionIdColumn})`;

    // Check for wallet's condition_ids
    const matchQuery = `
      WITH wallet_ids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count(*) as found,
        ${payoutColumns.map(col => `countIf(${col} IS NOT NULL AND ${col} != '') as has_${col.replace(/[^a-z0-9]/gi, '_')}`).join(',\n        ')}
      FROM wallet_ids w
      INNER JOIN ${tableName} t
        ON w.cid = ${idNormalization}
    `;

    const matches = await ch.query({
      query: matchQuery,
      format: 'JSONEachRow',
    });
    const matchData = await matches.json<any[]>();

    console.log(`\nMatches: ${matchData[0].found}/30 wallet condition_ids found`);

    Object.keys(matchData[0]).forEach(key => {
      if (key !== 'found' && key.startsWith('has_')) {
        const count = matchData[0][key];
        if (count > 0) {
          console.log(`  ✅ ${key.replace('has_', '')}: ${count} non-empty`);
        }
      }
    });

    // If we found matches, show sample data
    if (parseInt(matchData[0].found) > 0) {
      console.log(`\nSample data (first 3 matches):`);

      const sampleQuery = `
        WITH wallet_ids AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
          FROM default.vw_trades_canonical
          WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
            AND condition_id_norm != ''
            AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
        SELECT
          w.cid,
          ${payoutColumns.join(',\n          ')}
        FROM wallet_ids w
        INNER JOIN ${tableName} t
          ON w.cid = ${idNormalization}
        LIMIT 3
      `;

      const sample = await ch.query({
        query: sampleQuery,
        format: 'JSONEachRow',
      });
      const sampleData = await sample.json<any[]>();

      sampleData.forEach((row, i) => {
        console.log(`\n  ${i + 1}. Condition: ${row.cid.substring(0, 20)}...`);
        payoutColumns.forEach(col => {
          const val = row[col];
          if (val !== null && val !== undefined && val !== '') {
            console.log(`     ${col}: ${JSON.stringify(val).substring(0, 100)}`);
          }
        });
      });
    }

    return {
      table: tableName,
      found: parseInt(matchData[0].found),
      hasData: Object.keys(matchData[0]).some(k => k.startsWith('has_') && matchData[0][k] > 0)
    };

  } catch (e: any) {
    console.log(`\n❌ Error checking ${tableName}: ${e.message}`);
    return { table: tableName, found: 0, hasData: false, error: e.message };
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  COMPREHENSIVE RESOLUTION DATA SEARCH - EXHAUSTING ALL INTERNAL SOURCES       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nWallet: ${AUDIT_WALLET}`);
  console.log('Searching for: 30 condition_ids\n');

  const results: any[] = [];

  // Table 1: gamma_resolved
  results.push(await checkTable(
    'cascadian_clean.gamma_resolved',
    'condition_id',
    ['payout_numerators', 'payout_denominator', 'winning_index', 'outcome', 'resolved']
  ));

  // Table 2: resolution_candidates
  results.push(await checkTable(
    'cascadian_clean.resolution_candidates',
    'condition_id',
    ['payout_numerators', 'payout_denominator', 'winning_outcome', 'outcome_index']
  ));

  // Table 3: staging_resolutions_union
  results.push(await checkTable(
    'cascadian_clean.staging_resolutions_union',
    'condition_id',
    ['payout_numerators', 'payout_denominator', 'winning_index']
  ));

  // Table 4: market_resolutions_final_backup
  results.push(await checkTable(
    'cascadian_clean.market_resolutions_final_backup',
    'condition_id_norm',
    ['payout_numerators', 'payout_denominator', 'winning_index'],
    false // already normalized
  ));

  // Table 5: market_resolutions
  results.push(await checkTable(
    'cascadian_clean.market_resolutions',
    'condition_id',
    ['payout_numerators', 'payout_denominator', 'winning_outcome']
  ));

  // Table 6: market_resolutions_by_market
  results.push(await checkTable(
    'cascadian_clean.market_resolutions_by_market',
    'condition_id',
    ['payout_numerators', 'payout_denominator', 'outcome']
  ));

  // Table 7: market_key_map
  results.push(await checkTable(
    'cascadian_clean.market_key_map',
    'condition_id',
    ['resolved', 'outcome', 'question']
  ));

  // Table 8: api_ctf_bridge
  results.push(await checkTable(
    'cascadian_clean.api_ctf_bridge',
    'condition_id',
    ['resolved_outcome', 'market_id']
  ));

  // Summary
  console.log('\n\n╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY OF ALL SOURCES                                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Table                              | Found | Has Payout Data');
  console.log('─'.repeat(80));

  results.forEach(r => {
    const tableName = r.table.padEnd(35);
    const found = `${r.found}/30`.padEnd(6);
    const hasData = r.hasData ? '✅ YES' : '❌ NO';
    console.log(`${tableName} | ${found} | ${hasData}`);
  });

  const tablesWithData = results.filter(r => r.found > 0 && r.hasData);

  console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  VERDICT                                                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  if (tablesWithData.length > 0) {
    console.log(`🎯 FOUND PAYOUT DATA in ${tablesWithData.length} table(s):\n`);
    tablesWithData.forEach(r => {
      console.log(`  ✅ ${r.table} (${r.found} condition_ids)`);
    });
    console.log('\nNext steps:');
    console.log('1. Union these tables into vw_resolutions_truth');
    console.log('2. Re-run P&L views');
    console.log('3. Verify gap closes\n');
  } else {
    const tablesWithIds = results.filter(r => r.found > 0);
    if (tablesWithIds.length > 0) {
      console.log(`⚠️  Found condition_ids in ${tablesWithIds.length} table(s), but NO payout data:\n`);
      tablesWithIds.forEach(r => {
        console.log(`  - ${r.table} (${r.found} IDs, but empty payouts)`);
      });
      console.log('\nConclusion: Markets exist but are NOT resolved yet.\n');
      console.log('Options:');
      console.log('  A) Accept that markets are open (not resolved)');
      console.log('  B) Fetch from external APIs (if you have resolution data)');
      console.log('  C) Check if Polymarket shows them as resolved\n');
    } else {
      console.log('❌ ZERO matches in ANY internal table.\n');
      console.log('This is unexpected - condition_ids should exist somewhere.');
      console.log('Need to investigate ID format or data corruption.\n');
    }
  }

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ FATAL ERROR:', err);
  process.exit(1);
});
