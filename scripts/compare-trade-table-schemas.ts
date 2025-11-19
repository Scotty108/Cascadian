#!/usr/bin/env npx tsx
/**
 * Compare schemas of the two fact_trades_clean tables
 */

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
  console.log('\n🔍 COMPARING TRADE TABLE SCHEMAS\n');
  console.log('═'.repeat(80));

  // 1. Check cascadian_clean schema
  console.log('\n1️⃣ cascadian_clean.fact_trades_clean schema:\n');

  try {
    const schema1 = await ch.query({
      query: `DESCRIBE cascadian_clean.fact_trades_clean`,
      format: 'JSONEachRow'
    });
    const schema1Data = await schema1.json<any>();
    schema1Data.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type}`);
    });
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}\n`);
  }

  // 2. Check default schema
  console.log('\n2️⃣ default.fact_trades_clean schema:\n');

  try {
    const schema2 = await ch.query({
      query: `DESCRIBE default.fact_trades_clean`,
      format: 'JSONEachRow'
    });
    const schema2Data = await schema2.json<any>();
    schema2Data.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type}`);
    });
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}\n`);
  }

  // 3. Count rows in each
  console.log('\n3️⃣ Row counts:\n');

  const cascadianCount = await ch.query({
    query: `SELECT COUNT(*) as count FROM cascadian_clean.fact_trades_clean`,
    format: 'JSONEachRow'
  });
  const cascadianData = await cascadianCount.json<any>();
  console.log(`  cascadian_clean.fact_trades_clean: ${parseInt(cascadianData[0].count).toLocaleString()} rows`);

  const defaultCount = await ch.query({
    query: `SELECT COUNT(*) as count FROM default.fact_trades_clean`,
    format: 'JSONEachRow'
  });
  const defaultData = await defaultCount.json<any>();
  console.log(`  default.fact_trades_clean: ${parseInt(defaultData[0].count).toLocaleString()} rows\n`);

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
