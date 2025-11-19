#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== METADATA SCHEMA REFERENCE ===\n');

  // Check which tables exist
  const tablesResult = await clickhouse.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = 'default'
        AND (name = 'dim_markets' OR name = 'gamma_markets' OR name = 'api_markets_staging')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json<Array<{ name: string; total_rows: string }>>();

  console.log('--- AVAILABLE TABLES ---\n');
  tables.forEach(t => {
    console.log(`  ${t.name}: ${parseInt(t.total_rows || '0').toLocaleString()} rows`);
  });
  console.log();

  // For each table, get schema and sample nullity
  for (const table of tables) {
    console.log(`\n=== ${table.name.toUpperCase()} ===\n`);

    // Get schema
    const schemaResult = await clickhouse.query({
      query: `DESCRIBE TABLE default.${table.name}`,
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json<Array<{
      name: string;
      type: string;
      default_type: string;
      default_expression: string;
    }>>();

    console.log('--- SCHEMA ---\n');
    console.log('| Column | Type | Default |');
    console.log('|--------|------|---------|');
    schema.forEach(col => {
      const defaultVal = col.default_expression || col.default_type || '-';
      console.log(`| ${col.name} | ${col.type} | ${defaultVal} |`);
    });
    console.log();

    // Check nullity/sparsity for each column
    console.log('--- COLUMN QUALITY ---\n');

    const totalRows = parseInt(table.total_rows || '0');
    if (totalRows === 0) {
      console.log('⚠️  Table is empty, skipping quality checks\n');
      continue;
    }

    // Build query to check each column
    const qualityChecks = schema.map(col => {
      if (col.type.includes('Nullable')) {
        return `countIf(isNull(${col.name})) as ${col.name}_null`;
      } else if (col.type === 'String') {
        return `countIf(${col.name} = '') as ${col.name}_empty`;
      } else {
        return `0 as ${col.name}_ok`;
      }
    });

    const qualityQuery = `
      SELECT
        ${qualityChecks.join(',\n        ')}
      FROM default.${table.name}
    `;

    const qualityResult = await clickhouse.query({
      query: qualityQuery,
      format: 'JSONEachRow'
    });
    const quality = await qualityResult.json<Array<any>>();

    console.log('| Column | Null/Empty Count | % Coverage |');
    console.log('|--------|------------------|------------|');

    schema.forEach(col => {
      const nullCount = parseInt(quality[0][`${col.name}_null`] || quality[0][`${col.name}_empty`] || 0);
      const coverage = ((totalRows - nullCount) / totalRows * 100).toFixed(2);
      const emoji = nullCount === 0 ? '✅' : nullCount > totalRows * 0.5 ? '❌' : '⚠️';
      console.log(`| ${col.name} | ${nullCount.toLocaleString()} | ${coverage}% ${emoji} |`);
    });
    console.log();
  }
}

main().catch(console.error);
