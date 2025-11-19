#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkV3Tables() {
  console.log('=== Checking for v3 tables ===\n');

  // Check all pm_trades_canonical tables
  const tables = await clickhouse.query({
    query: `
      SELECT
        name,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database = 'default'
        AND name LIKE 'pm_trades_canonical%'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const tableList = await tables.json<Array<{name: string; total_rows: string; total_bytes: string}>>();

  console.log('Found tables:');
  tableList.forEach(t => {
    const rows = Number(t.total_rows);
    console.log(`  - ${t.name}: ${rows.toLocaleString()} rows`);
  });

  console.log('\n=== Checking schemas and time ranges ===\n');

  for (const table of tableList) {
    console.log(`\n--- ${table.name} ---`);

    // Get schema
    const schema = await clickhouse.query({
      query: `DESCRIBE TABLE ${table.name}`,
      format: 'JSONEachRow'
    });

    const columns = await schema.json<Array<{name: string; type: string}>>();
    const hasRepairSource = columns.some(c => c.name === 'id_repair_source');
    const hasConditionIdNormV2 = columns.some(c => c.name === 'condition_id_norm_v2');

    console.log(`Columns: ${columns.length} total`);
    console.log(`  - has id_repair_source: ${hasRepairSource}`);
    console.log(`  - has condition_id_norm_v2: ${hasConditionIdNormV2}`);

    // Get time range
    const timeRange = await clickhouse.query({
      query: `
        SELECT
          min(timestamp) as min_date,
          max(timestamp) as max_date,
          count() as total_rows
        FROM ${table.name}
      `,
      format: 'JSONEachRow'
    });

    const range = await timeRange.json<Array<{min_date: string; max_date: string; total_rows: string}>>();
    if (range[0]) {
      console.log(`Time range: ${range[0].min_date} to ${range[0].max_date}`);
      const totalRows = Number(range[0].total_rows);
      console.log(`Total rows: ${totalRows.toLocaleString()}`);
    }
  }
}

checkV3Tables().catch(console.error);
