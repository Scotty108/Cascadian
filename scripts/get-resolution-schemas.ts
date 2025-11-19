#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('📊 RESOLUTION & PAYOUT TABLE SCHEMAS');
  console.log('='.repeat(80));
  console.log();

  const criticalTables = [
    'token_per_share_payout',
    'market_resolutions_final',
    'market_resolutions_by_market',
    'resolution_timestamps'
  ];

  for (const tableName of criticalTables) {
    console.log(`TABLE: ${tableName}`);
    console.log('-'.repeat(80));

    try {
      // Get schema
      const schemaQuery = `DESCRIBE ${tableName}`;
      const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schema = await schemaResult.json() as any[];

      console.log('Schema:');
      schema.forEach(col => {
        const defaultExpr = col.default_expression ? ` DEFAULT ${col.default_expression}` : '';
        console.log(`  ${col.name.padEnd(35)} ${col.type}${defaultExpr}`);
      });
      console.log();

      // Get sample data
      const sampleQuery = `SELECT * FROM ${tableName} LIMIT 3`;
      const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
      const samples = await sampleResult.json() as any[];

      console.log('Sample Data:');
      samples.forEach((row, idx) => {
        console.log(`  Row ${idx + 1}:`);
        Object.entries(row).forEach(([key, value]) => {
          const displayValue = Array.isArray(value)
            ? `[${value.slice(0, 3).join(', ')}${value.length > 3 ? ', ...' : ''}]`
            : typeof value === 'string' && value.length > 50
            ? `${value.substring(0, 47)}...`
            : value;
          console.log(`    ${key}: ${displayValue}`);
        });
        console.log();
      });

      // Get row count
      const countQuery = `SELECT count() AS total FROM ${tableName}`;
      const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
      const count = await countResult.json() as any[];

      console.log(`Total Rows: ${count[0].total.toLocaleString()}`);
      console.log();
      console.log('='.repeat(80));
      console.log();
    } catch (error: any) {
      console.log(`Error: ${error.message}`);
      console.log();
      console.log('='.repeat(80));
      console.log();
    }
  }

  // Special check: Verify token_per_share_payout has valid data
  console.log('VERIFICATION: token_per_share_payout Coverage');
  console.log('-'.repeat(80));

  const coverageQuery = `
    SELECT
      count() AS total_conditions,
      countIf(length(pps) > 0) AS conditions_with_payout,
      round(conditions_with_payout / total_conditions * 100, 2) AS coverage_pct
    FROM token_per_share_payout
  `;

  const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverage = await coverageResult.json() as any[];

  console.log(`Total conditions: ${coverage[0].total_conditions.toLocaleString()}`);
  console.log(`Conditions with payout: ${coverage[0].conditions_with_payout.toLocaleString()}`);
  console.log(`Coverage: ${coverage[0].coverage_pct}%`);
  console.log();
}

main().catch(console.error);
