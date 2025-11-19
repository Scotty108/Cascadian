#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function checkSchemas() {
  console.log('Checking gamma table schemas...\n');

  // Check gamma_markets schema
  try {
    console.log('1. gamma_markets schema:');
    const r1 = await clickhouse.query({
      query: 'DESCRIBE gamma_markets',
      format: 'JSONEachRow',
    });
    const d1 = await r1.json();
    d1.forEach((col: any) => {
      console.log(`   ${col.name}: ${col.type}`);
    });
    console.log();
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Check gamma_resolved schema
  try {
    console.log('2. gamma_resolved schema:');
    const r2 = await clickhouse.query({
      query: 'DESCRIBE gamma_resolved',
      format: 'JSONEachRow',
    });
    const d2 = await r2.json();
    d2.forEach((col: any) => {
      console.log(`   ${col.name}: ${col.type}`);
    });
    console.log();
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Sample data from both
  try {
    console.log('3. Sample gamma_markets row:');
    const r3 = await clickhouse.query({
      query: 'SELECT * FROM gamma_markets LIMIT 1',
      format: 'JSONEachRow',
    });
    const d3 = await r3.json();
    console.log(JSON.stringify(d3[0], null, 2));
    console.log();
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  try {
    console.log('4. Sample gamma_resolved row:');
    const r4 = await clickhouse.query({
      query: 'SELECT * FROM gamma_resolved LIMIT 1',
      format: 'JSONEachRow',
    });
    const d4 = await r4.json();
    console.log(JSON.stringify(d4[0], null, 2));
    console.log();
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }
}

checkSchemas().catch(console.error);
