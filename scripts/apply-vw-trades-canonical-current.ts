#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';
import { readFileSync } from 'fs';

console.log('📊 Applying vw_trades_canonical_current View\n');

async function main() {
  // Step 1: Apply the DDL
  console.log('Step 1: Applying DDL from sql/views/vw_trades_canonical_current.sql...\n');

  const ddl = readFileSync(
    resolve(process.cwd(), 'sql/views/vw_trades_canonical_current.sql'),
    'utf-8'
  );

  await clickhouse.command({ query: ddl });
  console.log('✅ View created successfully\n');

  // Step 2: Verify row count
  console.log('Step 2: Verifying row count...\n');

  const countQuery = 'SELECT COUNT(*) as count FROM vw_trades_canonical_current';
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = await countResult.json() as any[];

  const totalRows = parseInt(countData[0].count);
  console.log(`Total rows: ${totalRows.toLocaleString()}\n`);

  // Step 3: Coverage breakdown
  console.log('Step 3: Coverage breakdown by canonical_condition_source...\n');

  const coverageQuery = `
    SELECT
      canonical_condition_source,
      COUNT(*) as count,
      ROUND(100.0 * count / SUM(count) OVER (), 2) as pct
    FROM vw_trades_canonical_current
    GROUP BY canonical_condition_source
    ORDER BY count DESC
  `;

  const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverageData = await coverageResult.json() as any[];

  console.log('Source    Trades              Percentage');
  console.log('─'.repeat(50));

  for (const row of coverageData) {
    const source = (row.canonical_condition_source || 'none').padEnd(8);
    const count = parseInt(row.count).toLocaleString().padStart(15);
    const pct = parseFloat(row.pct).toFixed(2).padStart(6);
    console.log(`${source}  ${count}     ${pct}%`);
  }

  console.log('');

  // Step 4: Valid condition ID count
  console.log('Step 4: Valid condition ID coverage...\n');

  const validQuery = `
    SELECT
      countIf(
        canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
        AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
      ) as valid_count,
      COUNT(*) as total_count
    FROM vw_trades_canonical_current
  `;

  const validResult = await clickhouse.query({ query: validQuery, format: 'JSONEachRow' });
  const validData = await validResult.json() as any[];

  const validCount = parseInt(validData[0].valid_count);
  const validPct = (validCount / totalRows * 100).toFixed(2);

  console.log(`Valid condition IDs: ${validCount.toLocaleString()} (${validPct}%)`);
  console.log(`Total trades: ${totalRows.toLocaleString()}`);
  console.log('');

  // Step 5: Sample query
  console.log('Step 5: Sample rows from view...\n');

  const sampleQuery = `
    SELECT
      transaction_hash,
      wallet_address,
      canonical_condition_id,
      canonical_condition_source,
      shares,
      price,
      usd_value,
      timestamp
    FROM vw_trades_canonical_current
    WHERE canonical_condition_id IS NOT NULL
    LIMIT 3
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json() as any[];

  console.log('Sample trades with valid canonical_condition_id:');
  for (const row of sampleData) {
    console.log(`  - ${row.transaction_hash.substring(0, 10)}... | ${row.canonical_condition_source} | $${row.usd_value}`);
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('✅ VERIFICATION COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Summary:');
  console.log(`- View: vw_trades_canonical_current`);
  console.log(`- Source: vw_trades_canonical_v3_preview → pm_trades_canonical_v3`);
  console.log(`- Total trades: ${totalRows.toLocaleString()}`);
  console.log(`- Valid condition IDs: ${validCount.toLocaleString()} (${validPct}%)`);
  console.log(`- Primary interface: canonical_condition_id, canonical_condition_source`);
  console.log('');
  console.log('Next step: Update PnL views to read from this canonical view');
}

main().catch(console.error);
