import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkGammaResolved() {
  console.log('\n🔍 Checking gamma_resolved table\n');
  
  try {
    // Check if table exists
    const existsQuery = `
      SELECT count() as row_count
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = 'gamma_resolved'
    `;
    
    const existsResult = await clickhouse.query({ query: existsQuery, format: 'JSONEachRow' });
    const exists = await existsResult.json();
    
    if (parseInt(exists[0].row_count) === 0) {
      console.log('❌ Table gamma_resolved DOES NOT EXIST');
      console.log('\nThe validation script requires this table for market resolutions.');
      console.log('Need to create it or use a different resolution table.');
      return;
    }
    
    console.log('✅ Table gamma_resolved exists\n');
    
    // Check row count
    const countQuery = 'SELECT count() as total_rows FROM gamma_resolved';
    const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
    const count = await countResult.json();
    
    console.log(`Total rows: ${count[0].total_rows}\n`);
    
    if (parseInt(count[0].total_rows) === 0) {
      console.log('⚠️  Table is EMPTY - no resolution data available');
      console.log('This explains why P&L validation shows no results.');
      return;
    }
    
    // Sample data
    console.log('Sample resolution data:\n');
    const sampleQuery = 'SELECT * FROM gamma_resolved LIMIT 5';
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json();
    console.table(samples);
    
  } catch (e: any) {
    console.log('❌ Error accessing gamma_resolved:', e.message);
  }
}

checkGammaResolved().catch(console.error);
