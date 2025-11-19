import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('=== CHECKING TRADE DATA ===\n');

  // Check trade data recency
  const recency = await client.query({
    query: `
      SELECT
        min(block_time) as earliest,
        max(block_time) as latest,
        count() as total_trades,
        count(DISTINCT cid) as unique_markets
      FROM fact_trades_clean
    `,
    format: 'JSONEachRow',
  });

  const recencyData = await recency.json();
  console.log('Trade Data Summary:');
  console.table(recencyData);

  // Sample trades
  console.log('\n=== SAMPLE TRADES ===\n');
  const samples = await client.query({
    query: `
      SELECT
        cid,
        outcome_index,
        price,
        block_time
      FROM fact_trades_clean
      ORDER BY block_time DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await samples.json();
  console.table(sampleData);

  // Check resolution condition_id format
  console.log('\n=== RESOLUTION CONDITION_ID FORMAT ===\n');
  const resolutions = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as id_length
      FROM market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const resData = await resolutions.json();
  console.table(resData);

  // Try to find overlap
  console.log('\n=== CHECKING FOR OVERLAP ===\n');
  const overlap = await client.query({
    query: `
      SELECT
        count() as overlap_count
      FROM (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
        LIMIT 1000
      ) t
      WHERE t.cid_norm IN (
        SELECT condition_id_norm
        FROM market_resolutions_final
      )
    `,
    format: 'JSONEachRow',
  });

  const overlapData = await overlap.json();
  console.log(`Overlap: ${overlapData[0]?.overlap_count || 0} markets\n`);

  // Check if issue is with normalization
  console.log('=== TESTING NORMALIZATION ===\n');
  const normTest = await client.query({
    query: `
      SELECT
        cid as original,
        lower(replaceAll(cid, '0x', '')) as normalized,
        length(lower(replaceAll(cid, '0x', ''))) as norm_length
      FROM fact_trades_clean
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const normData = await normTest.json();
  console.table(normData);
}

main().catch(console.error).finally(() => client.close());
