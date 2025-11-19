import { clickhouse } from './lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugJoin() {
  console.log('Testing NOT IN approach...\n');

  const result = await clickhouse.query({
    query: `
      SELECT count(*) as missing
      FROM gamma_markets gm
      WHERE lower(replaceAll(gm.condition_id, '0x', '')) NOT IN (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
        FROM clob_fills
      )
    `,
    format: 'JSONEachRow'
  });
  const data: any = await result.json();
  console.log(`Missing markets: ${data[0].missing.toLocaleString()}`);

  // Get sample
  console.log('\nFetching 5 sample missing markets...\n');
  const sample = await clickhouse.query({
    query: `
      SELECT condition_id, question
      FROM gamma_markets
      WHERE lower(replaceAll(condition_id, '0x', '')) NOT IN (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
        FROM clob_fills
      )
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const sampleData: any = await sample.json();
  sampleData.forEach((row: any, i: number) => {
    console.log(`${i + 1}. ${row.condition_id}`);
    console.log(`   ${row.question?.substring(0, 70)}...\n`);
  });
}

debugJoin().catch(console.error);
