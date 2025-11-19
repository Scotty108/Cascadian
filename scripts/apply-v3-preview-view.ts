#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';
import { readFileSync } from 'fs';

async function main() {
  console.log('📝 Applying vw_trades_canonical_v3_preview view...\n');

  // Read the DDL file
  const ddlPath = resolve(process.cwd(), 'sql/views/vw_trades_canonical_v3_preview.sql');
  const ddl = readFileSync(ddlPath, 'utf-8');

  try {
    // Apply the DDL
    await clickhouse.query({ query: ddl });
    console.log('✅ View created successfully\n');

    // Verify row count
    const countQuery = 'SELECT COUNT(*) as count FROM vw_trades_canonical_v3_preview';
    const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
    const countData = await countResult.json() as any[];
    const count = parseInt(countData[0].count);

    console.log(`✅ View verification:`);
    console.log(`   Total rows: ${count.toLocaleString()}\n`);

    // Check a sample row to verify columns
    const sampleQuery = `
      SELECT
        trade_id,
        canonical_condition_id,
        canonical_condition_source,
        condition_id_norm_v2,
        condition_id_norm_v3
      FROM vw_trades_canonical_v3_preview
      LIMIT 5
    `;
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json() as any[];

    console.log('✅ Sample rows (verifying columns):');
    for (const row of sampleData) {
      console.log(`   trade_id: ${row.trade_id}`);
      console.log(`   canonical_source: ${row.canonical_condition_source}`);
      console.log(`   canonical_cid: ${row.canonical_condition_id?.substring(0, 16)}...`);
      console.log('');
    }

    // Coverage breakdown
    const coverageQuery = `
      SELECT
        canonical_condition_source,
        COUNT(*) as count,
        ROUND(100.0 * count / SUM(count) OVER (), 2) as pct
      FROM vw_trades_canonical_v3_preview
      GROUP BY canonical_condition_source
      ORDER BY count DESC
    `;
    const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
    const coverageData = await coverageResult.json() as any[];

    console.log('📊 Canonical Condition Source Breakdown:');
    for (const row of coverageData) {
      const source = row.canonical_condition_source;
      const cnt = parseInt(row.count).toLocaleString();
      const pct = parseFloat(row.pct).toFixed(2);
      console.log(`   ${source.padEnd(6)} ${cnt.padStart(15)} (${pct}%)`);
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
