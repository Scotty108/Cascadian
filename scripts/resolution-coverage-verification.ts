#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function verifyResolutionCoverage() {
  console.log('=== RESOLUTION COVERAGE VERIFICATION ===\n');

  // 1. Check if market_resolutions_final exists
  console.log('1. Checking for market_resolutions_final table...');
  const tables = await client.query({
    query: `SHOW TABLES LIKE '%resolution%'`,
    format: 'JSONEachRow'
  });
  const tablesList = await tables.json<any>();
  console.log('Resolution tables found:', tablesList.map((t: any) => t.name).join(', '));
  console.log();

  // 2. Get schema of market_resolutions_final
  if (tablesList.some((t: any) => t.name === 'market_resolutions_final')) {
    console.log('2. Schema of market_resolutions_final:');
    const schema = await client.query({
      query: `DESCRIBE market_resolutions_final`,
      format: 'JSONEachRow'
    });
    const cols = await schema.json<any>();
    cols.forEach((c: any) => console.log(`  ${c.name}: ${c.type}`));
    console.log();

    // 3. Row count
    console.log('3. Row count in market_resolutions_final:');
    const count = await client.query({
      query: `SELECT COUNT(*) as count FROM market_resolutions_final`,
      format: 'JSONEachRow'
    });
    const countData = await count.json<any>();
    console.log(`  Total rows: ${countData[0].count.toLocaleString()}`);
    console.log();

    // 4. Unique condition_ids
    console.log('4. Unique condition_ids in market_resolutions_final:');
    const unique = await client.query({
      query: `SELECT COUNT(DISTINCT condition_id_norm) as count FROM market_resolutions_final`,
      format: 'JSONEachRow'
    });
    const uniqueData = await unique.json<any>();
    console.log(`  Unique conditions: ${uniqueData[0].count.toLocaleString()}`);
    console.log();
  }

  // 5. Unique condition_ids in trades_raw
  console.log('5. Unique condition_ids in trades_raw:');
  const tradesUnique = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id) as total_unique,
        COUNT(DISTINCT CASE WHEN condition_id != '' THEN condition_id END) as non_empty_unique,
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as trades_with_condition_id
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  });
  const tradesData = await tradesUnique.json<any>();
  console.log(`  Total unique condition_ids: ${tradesData[0].total_unique.toLocaleString()}`);
  console.log(`  Non-empty unique condition_ids: ${tradesData[0].non_empty_unique.toLocaleString()}`);
  console.log(`  Total trades: ${tradesData[0].total_trades.toLocaleString()}`);
  console.log(`  Trades with condition_id: ${tradesData[0].trades_with_condition_id.toLocaleString()}`);
  console.log();

  // 6. JOIN coverage test - Apply IDN (ID Normalization)
  console.log('6. Testing JOIN coverage (with normalized condition_id)...');
  const joinTest = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT t.condition_id) as total_conditions,
        COUNT(DISTINCT CASE WHEN r.condition_id_norm IS NOT NULL THEN t.condition_id END) as matched_conditions,
        COUNT(*) as total_trades,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as matched_trades
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const joinData = await joinTest.json<any>();
  const totalConditions = parseInt(joinData[0].total_conditions);
  const matchedConditions = parseInt(joinData[0].matched_conditions);
  const totalTrades = parseInt(joinData[0].total_trades);
  const matchedTrades = parseInt(joinData[0].matched_trades);

  console.log(`  Total unique conditions (non-empty): ${totalConditions.toLocaleString()}`);
  console.log(`  Matched conditions: ${matchedConditions.toLocaleString()} (${(matchedConditions/totalConditions*100).toFixed(2)}%)`);
  console.log(`  Total trades (non-empty condition_id): ${totalTrades.toLocaleString()}`);
  console.log(`  Matched trades: ${matchedTrades.toLocaleString()} (${(matchedTrades/totalTrades*100).toFixed(2)}%)`);
  console.log();

  // 7. Check for NULL payout data in matched resolutions
  console.log('7. Checking for NULL or missing payout data...');
  const nullCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN payout_numerators IS NULL OR length(payout_numerators) = 0 THEN 1 ELSE 0 END) as null_payouts,
        SUM(CASE WHEN payout_denominator IS NULL OR payout_denominator = 0 THEN 1 ELSE 0 END) as null_denominator,
        SUM(CASE WHEN winning_index IS NULL THEN 1 ELSE 0 END) as null_winning_index
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow'
  });
  const nullData = await nullCheck.json<any>();
  console.log(`  Total resolutions: ${nullData[0].total.toLocaleString()}`);
  console.log(`  NULL/empty payout_numerators: ${nullData[0].null_payouts}`);
  console.log(`  NULL/zero payout_denominator: ${nullData[0].null_denominator}`);
  console.log(`  NULL winning_index: ${nullData[0].null_winning_index}`);
  console.log();

  // 8. Sample unmatched condition_ids
  console.log('8. Sample of unmatched condition_ids (first 10):');
  const unmatched = await client.query({
    query: `
      SELECT DISTINCT t.condition_id
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
        AND r.condition_id_norm IS NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const unmatchedData = await unmatched.json<any>();
  unmatchedData.forEach((row: any) => console.log(`  ${row.condition_id}`));
  console.log();

  // 9. Check resolution data sources
  console.log('9. Resolution data sources breakdown:');
  const sources = await client.query({
    query: `
      SELECT
        source,
        COUNT(*) as count,
        COUNT(DISTINCT condition_id_norm) as unique_conditions
      FROM market_resolutions_final
      GROUP BY source
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const sourcesData = await sources.json<any>();
  sourcesData.forEach((row: any) => {
    console.log(`  ${row.source || '(empty)'}: ${row.count.toLocaleString()} rows, ${row.unique_conditions.toLocaleString()} unique conditions`);
  });
  console.log();

  // 10. Check for alternative resolution tables
  console.log('10. Checking for other resolution-related tables...');
  const allTables = await client.query({
    query: `SHOW TABLES`,
    format: 'JSONEachRow'
  });
  const allTablesList = await allTables.json<any>();
  const resolutionTables = allTablesList.filter((t: any) =>
    t.name.toLowerCase().includes('resolution') ||
    t.name.toLowerCase().includes('market') ||
    t.name.toLowerCase().includes('outcome')
  );
  console.log('Tables with resolution/market/outcome keywords:');
  resolutionTables.forEach((t: any) => console.log(`  - ${t.name}`));
  console.log();

  await client.close();
}

verifyResolutionCoverage().catch(console.error);
