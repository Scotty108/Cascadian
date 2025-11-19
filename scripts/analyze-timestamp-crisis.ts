import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function analyzeTimestampSituation() {
  console.log('=== COMPREHENSIVE TIMESTAMP ANALYSIS ===\n');

  try {
    // 1. Check table existence
    console.log('TASK 1: TABLE EXISTENCE CHECK');
    console.log('='.repeat(80));
    const tables = await client.query({
      query: `
        SELECT name, engine, total_rows, formatReadableSize(total_bytes) as size,
               metadata_modification_time
        FROM system.tables
        WHERE database = '${process.env.CLICKHOUSE_DATABASE}'
          AND (name LIKE '%block%timestamp%' OR name LIKE '%tmp_%')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const tableRows = await tables.json();
    console.log(JSON.stringify(tableRows, null, 2));
    console.log('\n');

    // 2. ERC1155 timestamp distribution
    console.log('TASK 2: ERC1155_TRANSFERS TIMESTAMP DISTRIBUTION');
    console.log('='.repeat(80));
    const timestampDist = await client.query({
      query: `
        SELECT
          countIf(timestamp = 0) as epoch_zero_count,
          countIf(timestamp > 0) as has_timestamp_count,
          count() as total_rows,
          round(countIf(timestamp = 0) * 100.0 / count(), 2) as epoch_zero_pct,
          round(countIf(timestamp > 0) * 100.0 / count(), 2) as has_timestamp_pct
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    });
    const tsRows = await timestampDist.json();
    console.log(JSON.stringify(tsRows, null, 2));
    console.log('\n');

    // 3. Date range of timestamped rows
    console.log('TASK 2b: DATE RANGE OF TIMESTAMPED ROWS');
    console.log('='.repeat(80));
    const dateRange = await client.query({
      query: `
        SELECT
          min(timestamp) as min_ts,
          max(timestamp) as max_ts,
          toDateTime(min(timestamp)) as min_date,
          toDateTime(max(timestamp)) as max_date,
          count() as row_count
        FROM erc1155_transfers
        WHERE timestamp > 0
      `,
      format: 'JSONEachRow'
    });
    const rangeRows = await dateRange.json();
    console.log(JSON.stringify(rangeRows, null, 2));
    console.log('\n');

    // 4. Other tables with timestamp data
    console.log('TASK 3: TIMESTAMP DATA IN OTHER TABLES');
    console.log('='.repeat(80));
    const otherSources = await client.query({
      query: `
        SELECT
          'usdc_transfers' as source,
          count() as total_rows,
          countIf(timestamp > 0) as with_timestamp,
          count(DISTINCT block_number) as unique_blocks,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM usdc_transfers

        UNION ALL

        SELECT
          'erc20_transfers' as source,
          count() as total_rows,
          countIf(timestamp > 0) as with_timestamp,
          count(DISTINCT block_number) as unique_blocks,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM erc20_transfers

        UNION ALL

        SELECT
          'erc1155_transfers' as source,
          count() as total_rows,
          countIf(timestamp > 0) as with_timestamp,
          count(DISTINCT block_number) as unique_blocks,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    });
    const otherRows = await otherSources.json();
    console.log(JSON.stringify(otherRows, null, 2));
    console.log('\n');

    // 5. Block overlap analysis
    console.log('TASK 4: BLOCK OVERLAP ANALYSIS (Sample 10K blocks)');
    console.log('='.repeat(80));
    const overlap = await client.query({
      query: `
        WITH erc_blocks AS (
          SELECT DISTINCT block_number
          FROM erc1155_transfers
          WHERE timestamp = 0
          LIMIT 10000
        )
        SELECT
          count() as blocks_needing_timestamp,
          countIf(u.timestamp > 0) as available_in_usdc,
          countIf(e.timestamp > 0) as available_in_erc20,
          round(countIf(u.timestamp > 0) * 100.0 / count(), 2) as usdc_coverage_pct,
          round(countIf(e.timestamp > 0) * 100.0 / count(), 2) as erc20_coverage_pct,
          round(countIf(u.timestamp > 0 OR e.timestamp > 0) * 100.0 / count(), 2) as combined_coverage_pct
        FROM erc_blocks eb
        LEFT JOIN (SELECT DISTINCT block_number, timestamp FROM usdc_transfers WHERE timestamp > 0) u
          ON eb.block_number = u.block_number
        LEFT JOIN (SELECT DISTINCT block_number, timestamp FROM erc20_transfers WHERE timestamp > 0) e
          ON eb.block_number = e.block_number
      `,
      format: 'JSONEachRow'
    });
    const overlapRows = await overlap.json();
    console.log(JSON.stringify(overlapRows, null, 2));
    console.log('\n');

    // 6. Unique blocks analysis
    console.log('TASK 5: UNIQUE BLOCKS NEEDING TIMESTAMPS');
    console.log('='.repeat(80));
    const uniqueBlocks = await client.query({
      query: `
        SELECT
          count(DISTINCT block_number) as unique_blocks_epoch_zero,
          min(block_number) as min_block,
          max(block_number) as max_block,
          max(block_number) - min(block_number) as block_range
        FROM erc1155_transfers
        WHERE timestamp = 0
      `,
      format: 'JSONEachRow'
    });
    const uniqueRows = await uniqueBlocks.json();
    console.log(JSON.stringify(uniqueRows, null, 2));
    console.log('\n');

    await client.close();

  } catch (error: any) {
    console.error('ERROR:', error.message);
    await client.close();
    process.exit(1);
  }
}

analyzeTimestampSituation().catch(console.error);
