import { clickhouse } from './lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkFormats() {
  console.log('Checking condition_id formats...\n');

  // Sample from gamma_markets
  const gmResult = await clickhouse.query({
    query: 'SELECT condition_id FROM gamma_markets LIMIT 5',
    format: 'JSONEachRow'
  });
  const gmData: any = await gmResult.json();

  console.log('gamma_markets condition_id samples:');
  gmData.forEach((row: any, i: number) => {
    console.log(`  ${i + 1}. ${row.condition_id} (length: ${row.condition_id.length})`);
  });

  // Sample from clob_fills
  const cfResult = await clickhouse.query({
    query: 'SELECT DISTINCT condition_id FROM clob_fills LIMIT 5',
    format: 'JSONEachRow'
  });
  const cfData: any = await cfResult.json();

  console.log('\nclob_fills condition_id samples:');
  cfData.forEach((row: any, i: number) => {
    console.log(`  ${i + 1}. ${row.condition_id} (length: ${row.condition_id.length})`);
  });
}

checkFormats().catch(console.error);
