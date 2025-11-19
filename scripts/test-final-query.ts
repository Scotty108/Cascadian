#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function testFinalQuery() {
  console.log('Testing FINAL query on clob_fills_v2...\n');

  // Check without FINAL
  try {
    console.log('1. Without FINAL:');
    const r1 = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM clob_fills_v2',
      format: 'JSONEachRow',
    });
    const d1 = await r1.json();
    console.log(`   Rows: ${d1[0].count}\n`);
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Check with FINAL
  try {
    console.log('2. With FINAL:');
    const r2 = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM clob_fills_v2 FINAL',
      format: 'JSONEachRow',
    });
    const d2 = await r2.json();
    console.log(`   Rows: ${d2[0].count}\n`);
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Check system.parts
  try {
    console.log('3. Table parts (background merge status):');
    const r3 = await clickhouse.query({
      query: `
        SELECT
          partition,
          name,
          rows,
          active
        FROM system.parts
        WHERE database = 'default' AND table = 'clob_fills_v2'
        ORDER BY modification_time DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const d3 = await r3.json();
    if (d3.length === 0) {
      console.log('   No parts found (table empty or not yet merged)\n');
    } else {
      d3.forEach((part: any) => {
        console.log(`   Partition: ${part.partition}, Part: ${part.name}, Rows: ${part.rows}, Active: ${part.active}`);
      });
      console.log();
    }
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }
}

testFinalQuery().catch(console.error);
