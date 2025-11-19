#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function checkStagingState() {
  console.log('Checking Goldsky staging infrastructure...\n');

  // Check if staging tables exist
  try {
    console.log('1. Checking clob_fills_v2:');
    const r1 = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM clob_fills_v2',
      format: 'JSONEachRow',
    });
    const d1 = await r1.json();
    console.log(`   Rows: ${d1[0].count}\n`);
  } catch (e: any) {
    console.log(`   ❌ Table not found: ${e.message}\n`);
  }

  // Check gamma_resolved count
  try {
    console.log('2. Checking gamma_resolved (priority markets):');
    const r2 = await clickhouse.query({
      query: 'SELECT COUNT(*) as count, COUNT(DISTINCT condition_id) as unique_conditions FROM gamma_resolved',
      format: 'JSONEachRow',
    });
    const d2 = await r2.json();
    console.log(`   Rows: ${d2[0].count}, Unique conditions: ${d2[0].unique_conditions}\n`);
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Check gamma_markets count
  try {
    console.log('3. Checking gamma_markets (all markets):');
    const r3 = await clickhouse.query({
      query: 'SELECT COUNT(*) as count, COUNT(DISTINCT condition_id) as unique_conditions FROM gamma_markets',
      format: 'JSONEachRow',
    });
    const d3 = await r3.json();
    console.log(`   Rows: ${d3[0].count}, Unique conditions: ${d3[0].unique_conditions}\n`);
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Sample condition IDs from gamma_resolved
  try {
    console.log('4. Sample condition IDs from gamma_resolved:');
    const r4 = await clickhouse.query({
      query: 'SELECT condition_id FROM gamma_resolved LIMIT 5',
      format: 'JSONEachRow',
    });
    const d4 = await r4.json();
    d4.forEach((row: any, idx: number) => {
      console.log(`   ${idx + 1}. ${row.condition_id}`);
    });
    console.log();
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }
}

checkStagingState().catch(console.error);
