#!/usr/bin/env tsx
/**
 * Phase 1, Step 1.2: Check remaining table schemas
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('🔍 Checking Remaining Table Schemas');
  console.log('='.repeat(80));
  console.log('');

  // Check clob_fills
  console.log('1. clob_fills schema:');
  console.log('-'.repeat(80));
  try {
    const result = await clickhouse.query({
      query: 'DESCRIBE clob_fills',
      format: 'JSONEachRow'
    });
    const schema = await result.json() as any[];
    schema.forEach(col => {
      console.log(`  ${col.name.padEnd(25)} ${col.type}`);
    });

    // Sample data
    console.log('\nSample row:');
    const sampleResult = await clickhouse.query({
      query: 'SELECT * FROM clob_fills LIMIT 1',
      format: 'JSONEachRow'
    });
    const sample = await sampleResult.json() as any[];
    if (sample.length > 0) {
      console.log(JSON.stringify(sample[0], null, 2));
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('');

  // Check market_resolutions_final
  console.log('2. market_resolutions_final schema:');
  console.log('-'.repeat(80));
  try {
    const result = await clickhouse.query({
      query: 'DESCRIBE market_resolutions_final',
      format: 'JSONEachRow'
    });
    const schema = await result.json() as any[];
    schema.forEach(col => {
      console.log(`  ${col.name.padEnd(25)} ${col.type}`);
    });

    // Sample data
    console.log('\nSample row:');
    const sampleResult = await clickhouse.query({
      query: 'SELECT * FROM market_resolutions_final LIMIT 1',
      format: 'JSONEachRow'
    });
    const sample = await sampleResult.json() as any[];
    if (sample.length > 0) {
      console.log(JSON.stringify(sample[0], null, 2));
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);
