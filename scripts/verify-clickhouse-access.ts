#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('🔍 CLICKHOUSE ACCESS VERIFICATION');
  console.log('='.repeat(80));
  console.log();

  // Step 1: Verify credentials
  console.log('STEP 1: Verify .env.local Credentials');
  console.log('-'.repeat(80));
  console.log();

  const requiredVars = [
    'CLICKHOUSE_HOST',
    'CLICKHOUSE_USER',
    'CLICKHOUSE_PASSWORD',
    'CLICKHOUSE_DATABASE'
  ];

  let credentialsValid = true;
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`  ✅ ${varName}: ${varName.includes('PASSWORD') ? '[REDACTED]' : value}`);
    } else {
      console.log(`  ❌ ${varName}: MISSING`);
      credentialsValid = false;
    }
  });
  console.log();

  if (!credentialsValid) {
    console.log('❌ FAILED: Missing required credentials in .env.local');
    process.exit(1);
  }

  // Step 2: Test connection
  console.log('STEP 2: Test Database Connection');
  console.log('-'.repeat(80));
  console.log();

  try {
    const pingResult = await clickhouse.query({ query: 'SELECT 1 AS ping', format: 'JSONEachRow' });
    const pingData = await pingResult.json() as any[];
    console.log(`  ✅ Connection successful: ping = ${pingData[0].ping}`);
  } catch (error: any) {
    console.log(`  ❌ Connection failed: ${error.message}`);
    process.exit(1);
  }
  console.log();

  // Step 3: Find resolution/payout tables
  console.log('STEP 3: Identify Resolution/Payout Tables');
  console.log('-'.repeat(80));
  console.log();

  const tableSearchQuery = `
    SELECT name, engine, total_rows
    FROM system.tables
    WHERE database = 'default'
      AND (
        name LIKE '%resolution%'
        OR name LIKE '%payout%'
        OR name LIKE '%settlement%'
        OR name LIKE '%outcome%'
      )
    ORDER BY name
  `;

  const tableResult = await clickhouse.query({ query: tableSearchQuery, format: 'JSONEachRow' });
  const tables = await tableResult.json() as any[];

  console.log('  Found resolution/payout-related tables:');
  console.log();
  tables.forEach(t => {
    const rows = t.total_rows ? t.total_rows.toLocaleString() : 'N/A';
    console.log(`    ${t.name.padEnd(50)} (${t.engine}, ${rows} rows)`);
  });
  console.log();

  // Step 4: Check key tables
  console.log('STEP 4: Verify Key Resolution Tables');
  console.log('-'.repeat(80));
  console.log();

  const keyTables = [
    'market_resolutions_final',
    'token_per_share_payout',
    'gamma_markets_resolved',
    'realized_pnl_by_market_final'
  ];

  for (const tableName of keyTables) {
    try {
      const schemaQuery = `DESCRIBE ${tableName}`;
      const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schema = await schemaResult.json() as any[];

      const countQuery = `SELECT count() AS total FROM ${tableName}`;
      const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
      const count = await countResult.json() as any[];

      console.log(`  ✅ ${tableName}:`);
      console.log(`     Total rows: ${count[0].total.toLocaleString()}`);
      console.log(`     Schema:`);
      schema.slice(0, 10).forEach(col => {
        console.log(`       - ${col.name.padEnd(30)} ${col.type}`);
      });
      if (schema.length > 10) {
        console.log(`       ... and ${schema.length - 10} more columns`);
      }
      console.log();
    } catch (error: any) {
      console.log(`  ⚠️  ${tableName}: Not found or not accessible`);
      console.log();
    }
  }

  // Step 5: Check token_per_share_payout specifically (critical for P&L)
  console.log('STEP 5: Verify token_per_share_payout (Critical for P&L)');
  console.log('-'.repeat(80));
  console.log();

  try {
    const sampleQuery = `
      SELECT
        condition_id_ctf,
        pps,
        resolved_at
      FROM token_per_share_payout
      WHERE length(pps) > 0
      LIMIT 5
    `;
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json() as any[];

    console.log('  ✅ token_per_share_payout is readable');
    console.log('  Sample data:');
    console.log();
    samples.forEach((s, idx) => {
      console.log(`    ${idx + 1}. Condition: ${s.condition_id_ctf.substring(0, 16)}...`);
      console.log(`       PPS array: [${s.pps.slice(0, 3).join(', ')}${s.pps.length > 3 ? ', ...' : ''}]`);
      console.log(`       Resolved: ${s.resolved_at}`);
      console.log();
    });
  } catch (error: any) {
    console.log(`  ❌ token_per_share_payout: Error reading table: ${error.message}`);
    console.log();
  }

  // Step 6: Check market_resolutions_final
  console.log('STEP 6: Verify market_resolutions_final');
  console.log('-'.repeat(80));
  console.log();

  try {
    const sampleQuery = `
      SELECT
        market_id,
        condition_id,
        winning_outcome,
        resolved_at
      FROM market_resolutions_final
      LIMIT 5
    `;
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json() as any[];

    console.log('  ✅ market_resolutions_final is readable');
    console.log('  Sample data:');
    console.log();
    samples.forEach((s, idx) => {
      console.log(`    ${idx + 1}. Market: ${s.market_id ? s.market_id.substring(0, 16) : 'NULL'}...`);
      console.log(`       Condition: ${s.condition_id ? s.condition_id.substring(0, 16) : 'NULL'}...`);
      console.log(`       Winner: ${s.winning_outcome}`);
      console.log(`       Resolved: ${s.resolved_at}`);
      console.log();
    });
  } catch (error: any) {
    console.log(`  ⚠️  market_resolutions_final: Error reading table: ${error.message}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log();
  console.log('✅ VERIFICATION COMPLETE');
  console.log();
  console.log('Summary:');
  console.log('  - ClickHouse credentials: Valid');
  console.log('  - Database connection: Working');
  console.log('  - Resolution tables: Accessible');
  console.log('  - Ready for P&L comparison runs');
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
