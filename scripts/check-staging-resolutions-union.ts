#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

(async () => {
  console.log('\n🔍 Investigating staging_resolutions_union (544K rows)...\n');

  // Check schema
  const schema = await ch.query({
    query: 'DESCRIBE staging_resolutions_union',
    format: 'JSONEachRow',
  });
  const cols = await schema.json();
  console.log('Schema:');
  cols.forEach((c: any) => console.log(`  ${c.name}: ${c.type}`));

  // Check sample data
  console.log('\n📊 Sample data (first 3 rows):\n');
  const sample = await ch.query({
    query: 'SELECT * FROM staging_resolutions_union LIMIT 3',
    format: 'JSONEachRow',
  });
  const rows = await sample.json();
  rows.forEach((r: any, i: number) => {
    console.log(`${i + 1}.`, JSON.stringify(r, null, 2));
  });

  // Check how many have actual payouts
  console.log('\n📊 Resolution status breakdown:\n');
  const stats = await ch.query({
    query: `
      SELECT
        CASE
          WHEN payout_denominator > 0 THEN 'HAS_PAYOUT'
          WHEN payout_denominator = 0 THEN 'ZERO_DENOMINATOR'
          WHEN payout_denominator IS NULL THEN 'NULL_DENOMINATOR'
          ELSE 'UNKNOWN'
        END as status,
        COUNT(*) as count
      FROM staging_resolutions_union
      GROUP BY status
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  const statRows = await stats.json();
  statRows.forEach((s: any) => {
    console.log(`  ${s.status}: ${s.count}`);
  });

  // Check overlap with our missing markets
  console.log('\n📊 Checking if this table has our missing markets...\n');
  const overlap = await ch.query({
    query: `
      WITH missing_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
        WHERE lower(replaceAll(cid, '0x', '')) NOT IN (
          SELECT condition_id_norm
          FROM market_resolutions_final
          WHERE payout_denominator > 0
        )
        LIMIT 1000
      )
      SELECT
        COUNT(DISTINCT mm.condition_id) as total_missing,
        COUNT(DISTINCT sru.condition_id_norm) as found_in_staging
      FROM missing_markets mm
      LEFT JOIN staging_resolutions_union sru
        ON mm.condition_id = sru.condition_id_norm
    `,
    format: 'JSONEachRow',
  });
  const overlapData = await overlap.json();
  console.log('Overlap check (1000 sample missing markets):');
  console.log(JSON.stringify(overlapData[0], null, 2));

  await ch.close();
})();
