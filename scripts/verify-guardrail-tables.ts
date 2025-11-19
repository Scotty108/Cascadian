#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function verifyGuardrailTables() {
  console.log('🔍 Verifying Guardrail Tables...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) AS size,
        create_table_query
      FROM system.tables
      WHERE database = currentDatabase()
        AND name IN ('pm_trades_attribution_conflicts', 'pm_collision_monitor_log')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const tables = await result.json<any>();

  for (const table of tables) {
    console.log(`📋 ${table.name}`);
    console.log(`   Engine: ${table.engine}`);
    console.log(`   Rows: ${table.total_rows}`);
    console.log(`   Size: ${table.size}`);
    console.log('');
  }

  if (tables.length === 2) {
    console.log('✅ Both guardrail tables exist and are ready!');
  } else {
    console.log(`❌ Expected 2 tables, found ${tables.length}`);
  }
}

verifyGuardrailTables().catch(console.error);
