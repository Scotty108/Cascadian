import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkData() {
  console.log('\n📊 Checking gamma_markets data structure\n');
  
  // Check if there's a metadata field or clobTokenIds
  const sampleQuery = 'SELECT * FROM gamma_markets LIMIT 3';
  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json();
  
  if (samples.length > 0) {
    console.log('Sample row:');
    console.log(JSON.stringify(samples[0], null, 2));
    
    console.log('\n\nColumn keys:', Object.keys(samples[0]));
    
    // Check outcomes_json structure
    if (samples[0].outcomes_json) {
      console.log('\n\noutcomes_json sample:');
      console.log(samples[0].outcomes_json);
    }
  }
  
  // Check counts
  console.log('\n\n📈 Table stats:\n');
  const statsQuery = `
    SELECT
      count() as total_rows,
      uniq(condition_id) as unique_conditions,
      uniq(token_id) as unique_tokens
    FROM gamma_markets
  `;
  const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = await statsResult.json();
  console.table(stats);
}

checkData().catch(console.error);
