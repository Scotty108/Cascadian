#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n🔍 COUNTING MISSING MARKETS (CORRECT METHOD)\n');

  // Method 1: Count unique condition_ids in trades
  console.log('Method 1: Direct counts...');
  const tradesCount = await ch.query({
    query: `SELECT COUNT(DISTINCT lower(replaceAll(cid_hex, '0x', ''))) as count FROM cascadian_clean.fact_trades_clean`,
    format: 'JSONEachRow'
  });
  const tradesData = await tradesCount.json<any>();
  console.log(`  Unique condition_ids traded: ${parseInt(tradesData[0].count).toLocaleString()}`);

  const stagingCount = await ch.query({
    query: `SELECT COUNT(DISTINCT condition_id) as count FROM default.api_markets_staging`,
    format: 'JSONEachRow'
  });
  const stagingData = await stagingCount.json<any>();
  console.log(`  Unique condition_ids in staging: ${parseInt(stagingData[0].count).toLocaleString()}`);

  const gap = parseInt(tradesData[0].count) - parseInt(stagingData[0].count);
  console.log(`  → GAP: ${gap.toLocaleString()} markets missing\n`);

  // Method 2: Sample to confirm
  console.log('Method 2: Sampling 100 traded condition_ids...');
  const sample = await ch.query({
    query: `
      WITH traded_ids AS (
        SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid
        FROM cascadian_clean.fact_trades_clean
        LIMIT 100
      )
      SELECT
        t.cid,
        CASE WHEN s.condition_id IS NOT NULL THEN 1 ELSE 0 END as in_staging
      FROM traded_ids t
      LEFT JOIN default.api_markets_staging s
        ON t.cid = s.condition_id
    `,
    format: 'JSONEachRow'
  });

  const sampleData = await sample.json<any>();
  const inStaging = sampleData.filter((r: any) => r.in_staging === 1).length;
  const missing = 100 - inStaging;

  console.log(`  Sample: ${inStaging}/100 found in staging`);
  console.log(`  Sample: ${missing}/100 missing from staging`);
  console.log(`  → Extrapolated: ${Math.round(missing/100 * parseInt(tradesData[0].count)).toLocaleString()} markets missing\n`);

  await ch.close();
}

main();
