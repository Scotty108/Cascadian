#!/usr/bin/env npx tsx
/**
 * Find ALL sources of numeric payout data
 * We need payout_numerators + payout_denominator, not text outcomes
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n🔍 FINDING ALL PAYOUT SOURCES\n');
  console.log('═'.repeat(80));

  // Get all tables in default and cascadian_clean
  const tables = await ch.query({
    query: `
      SELECT database, name
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND engine NOT LIKE '%View%'
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  });

  const tablesList = await tables.json<any>();

  console.log(`\nChecking ${tablesList.length} tables for payout data...\n`);

  const payoutSources: any[] = [];

  for (const table of tablesList) {
    const fullName = `${table.database}.${table.name}`;

    try {
      // Check schema
      const schema = await ch.query({
        query: `DESCRIBE ${fullName}`,
        format: 'JSONEachRow'
      });

      const columns = await schema.json<any>();
      const columnNames = columns.map((c: any) => c.name.toLowerCase());

      // Check if has payout columns
      const hasPayoutNumerators = columnNames.some(c => c.includes('payout_numerator'));
      const hasPayoutDenominator = columnNames.some(c => c.includes('payout_denominator'));

      if (hasPayoutNumerators && hasPayoutDenominator) {
        // Count rows
        const count = await ch.query({
          query: `SELECT COUNT(*) as total FROM ${fullName}`,
          format: 'JSONEachRow'
        });

        const countData = await count.json<any>();

        // Count unique condition_ids
        const conditionCols = columnNames.filter(c => c.includes('condition'));
        let uniqueConditions = 0;

        if (conditionCols.length > 0) {
          const cidCol = conditionCols[0];
          const uniqueQuery = await ch.query({
            query: `SELECT COUNT(DISTINCT ${cidCol}) as unique_count FROM ${fullName}`,
            format: 'JSONEachRow'
          });
          const uniqueData = await uniqueQuery.json<any>();
          uniqueConditions = parseInt(uniqueData[0].unique_count);
        }

        payoutSources.push({
          table: fullName,
          rows: parseInt(countData[0].total),
          unique_conditions: uniqueConditions,
          condition_column: conditionCols[0] || 'unknown'
        });

        console.log(`✓ ${fullName}`);
        console.log(`  Rows: ${parseInt(countData[0].total).toLocaleString()}`);
        console.log(`  Unique conditions: ${uniqueConditions.toLocaleString()}`);
        console.log(`  Condition column: ${conditionCols[0] || 'unknown'}\n`);
      }
    } catch (e) {
      // Skip tables that error
    }
  }

  console.log('═'.repeat(80));
  console.log('📊 PAYOUT SOURCES SUMMARY\n');

  if (payoutSources.length === 0) {
    console.log('❌ NO PAYOUT SOURCES FOUND!\n');
  } else {
    console.log(`Found ${payoutSources.length} table(s) with payout data:\n`);

    payoutSources.sort((a, b) => b.unique_conditions - a.unique_conditions);

    payoutSources.forEach((source, i) => {
      console.log(`${i + 1}. ${source.table}`);
      console.log(`   Unique conditions: ${source.unique_conditions.toLocaleString()}`);
      console.log(`   Total rows: ${source.rows.toLocaleString()}\n`);
    });

    // Now check coverage against traded markets
    console.log('Testing coverage against traded markets:\n');

    for (const source of payoutSources.slice(0, 3)) { // Top 3 sources
      const coverage = await ch.query({
        query: `
          WITH
            traded AS (
              SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
              FROM default.fact_trades_clean
            )
          SELECT
            COUNT(DISTINCT t.cid_norm) as traded_markets,
            COUNT(DISTINCT CASE WHEN r.${source.condition_column} IS NOT NULL THEN t.cid_norm END) as covered_markets,
            ROUND(covered_markets / traded_markets * 100, 2) as coverage_pct
          FROM traded t
          LEFT JOIN ${source.table} r
            ON t.cid_norm = lower(replaceAll(r.${source.condition_column}, '0x', ''))
        `,
        format: 'JSONEachRow'
      });

      const coverageData = await coverage.json<any>();
      console.log(`  ${source.table}:`);
      console.log(`    Coverage: ${coverageData[0].coverage_pct}% (${parseInt(coverageData[0].covered_markets).toLocaleString()}/${parseInt(coverageData[0].traded_markets).toLocaleString()} markets)\n`);
    }
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
