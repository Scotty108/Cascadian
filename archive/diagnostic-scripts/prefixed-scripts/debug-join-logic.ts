import { clickhouse } from './lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugJoin() {
  console.log('Testing different JOIN approaches...\n');

  // Approach 1: Current diagnostic approach
  const approach1 = await clickhouse.query({
    query: `
      SELECT count(*) as missing
      FROM gamma_markets gm
      LEFT JOIN (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM clob_fills
      ) cf ON lower(replaceAll(gm.condition_id, '0x', '')) = cf.cid
      WHERE cf.cid IS NULL
    `,
    format: 'JSONEachRow'
  });
  const data1: any = await approach1.json();
  console.log(`Approach 1 (LEFT JOIN with normalized keys): ${data1[0].missing.toLocaleString()} missing`);

  // Approach 2: NOT EXISTS
  const approach2 = await clickhouse.query({
    query: `
      SELECT count(*) as missing
      FROM gamma_markets gm
      WHERE NOT EXISTS (
        SELECT 1 FROM clob_fills cf
        WHERE lower(replaceAll(cf.condition_id, '0x', '')) = lower(replaceAll(gm.condition_id, '0x', ''))
      )
    `,
    format: 'JSONEachRow'
  });
  const data2: any = await approach2.json();
  console.log(`Approach 2 (NOT EXISTS): ${data2[0].missing.toLocaleString()} missing`);

  // Approach 3: Subquery IN
  const approach3 = await clickhouse.query({
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
  const data3: any = await approach3.json();
  console.log(`Approach 3 (NOT IN subquery): ${data3[0].missing.toLocaleString()} missing`);

  // Sample missing market
  console.log('\nSample missing market:');
  const sample = await clickhouse.query({
    query: `
      SELECT gm.condition_id, gm.question
      FROM gamma_markets gm
      WHERE lower(replaceAll(gm.condition_id, '0x', '')) NOT IN (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
        FROM clob_fills
      )
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const sampleData: any = await sample.json();
  if (sampleData.length > 0) {
    console.log(`  Condition ID: ${sampleData[0].condition_id}`);
    console.log(`  Question: ${sampleData[0].question?.substring(0, 80)}`);
  }
}

debugJoin().catch(console.error);
