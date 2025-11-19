#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('LAST-DITCH RESOLUTION SEARCH');
  console.log('═'.repeat(80));
  console.log();

  // 1. Find ALL tables with "resolution", "resolved", "outcome", "winner", "closed", "finalized" in name
  console.log('1. Searching for ALL potentially relevant tables...');
  const allTables = await client.query({
    query: `
      SELECT database, name, engine, total_rows
      FROM system.tables
      WHERE (
        name ILIKE '%resolution%' OR
        name ILIKE '%resolved%' OR
        name ILIKE '%outcome%' OR
        name ILIKE '%winner%' OR
        name ILIKE '%closed%' OR
        name ILIKE '%final%' OR
        name ILIKE '%payout%'
      )
      AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });

  const tables = await allTables.json<Array<{database: string; name: string; engine: string; total_rows: number}>>();
  console.log(`Found ${tables.length} tables:\n`);
  tables.forEach(t => {
    console.log(`  ${t.database}.${t.name} (${t.total_rows.toLocaleString()} rows, ${t.engine})`);
  });
  console.log();

  // 2. Check vw_trades_canonical_v2 resolution data more carefully
  console.log('2. Checking vw_trades_canonical_v2 resolution coverage...');
  const v2Coverage = await client.query({
    query: `
      SELECT
        count(DISTINCT condition_id_norm) AS unique_markets,
        countIf(is_resolved = 1, DISTINCT condition_id_norm) AS resolved_markets,
        countIf(is_resolved = 1) AS resolved_trades
      FROM default.vw_trades_canonical_v2
      WHERE length(condition_id_norm) > 0
    `,
    format: 'JSONEachRow',
  });

  const v2 = (await v2Coverage.json<Array<any>>())[0];
  console.log(`  Unique markets:    ${v2.unique_markets.toLocaleString()}`);
  console.log(`  Resolved markets:  ${v2.resolved_markets.toLocaleString()}`);
  console.log(`  Resolved trades:   ${v2.resolved_trades.toLocaleString()}`);
  console.log();

  // 3. Check for any "status" or "state" columns that might indicate closure
  console.log('3. Looking for market status/state tables...');
  const statusTables = await client.query({
    query: `
      SELECT database, name, total_rows
      FROM system.tables
      WHERE (
        name ILIKE '%status%' OR
        name ILIKE '%state%' OR
        name ILIKE '%market%'
      )
      AND total_rows > 100
      ORDER BY total_rows DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const status = await statusTables.json<Array<any>>();
  console.log(`Found ${status.length} status/state tables:\n`);
  status.forEach(t => {
    console.log(`  ${t.database}.${t.name} (${t.total_rows.toLocaleString()} rows)`);
  });
  console.log();

  // 4. Check if there's blockchain event data with resolutions
  console.log('4. Checking blockchain event tables...');
  const eventTables = await client.query({
    query: `
      SELECT database, name, total_rows
      FROM system.tables
      WHERE (
        name ILIKE '%event%' OR
        name ILIKE '%log%' OR
        name ILIKE '%ctf%' OR
        name ILIKE '%contract%'
      )
      AND total_rows > 1000
      ORDER BY total_rows DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const events = await eventTables.json<Array<any>>();
  console.log(`Found ${events.length} event tables:\n`);
  events.forEach(t => {
    console.log(`  ${t.database}.${t.name} (${t.total_rows.toLocaleString()} rows)`);
  });
  console.log();

  // 5. Check missing markets - are they recent (likely OPEN) or old (likely need backfill)?
  console.log('5. Analyzing missing markets by age...');
  const missingAge = await client.query({
    query: `
      WITH missing_markets AS (
        SELECT DISTINCT
          condition_id_norm,
          min(timestamp) AS first_trade,
          max(timestamp) AS last_trade,
          dateDiff('day', first_trade, now()) AS days_since_first,
          dateDiff('day', last_trade, now()) AS days_since_last
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND lower(condition_id_norm) NOT IN (
            SELECT cid_hex FROM cascadian_clean.vw_resolutions_all
          )
        GROUP BY condition_id_norm
      )
      SELECT
        countIf(days_since_last < 7) AS active_last_week,
        countIf(days_since_last >= 7 AND days_since_last < 30) AS active_last_month,
        countIf(days_since_last >= 30 AND days_since_last < 90) AS active_last_quarter,
        countIf(days_since_last >= 90) AS older_than_90_days
      FROM missing_markets
    `,
    format: 'JSONEachRow',
  });

  const age = (await missingAge.json<Array<any>>())[0];
  console.log('Missing markets by last trade date:');
  console.log(`  Last 7 days:      ${age.active_last_week.toLocaleString()} (likely OPEN)`);
  console.log(`  Last 30 days:     ${age.active_last_month.toLocaleString()} (likely OPEN)`);
  console.log(`  Last 90 days:     ${age.active_last_quarter.toLocaleString()} (might be closed)`);
  console.log(`  Older than 90d:   ${age.older_than_90_days.toLocaleString()} (likely need backfill)`);
  console.log();

  // 6. Sample some missing old markets to check manually
  console.log('6. Sample of old missing markets (for manual API check)...');
  const oldSample = await client.query({
    query: `
      SELECT DISTINCT
        condition_id_norm,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(condition_id_norm) NOT IN (
          SELECT cid_hex FROM cascadian_clean.vw_resolutions_all
        )
      GROUP BY condition_id_norm
      HAVING dateDiff('day', max(timestamp), now()) > 90
      ORDER BY first_trade ASC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const old = await oldSample.json();
  console.log('Old markets without resolutions:');
  old.forEach((m: any) => {
    console.log(`  ${m.condition_id_norm} | first: ${m.first_trade} | last: ${m.last_trade}`);
  });
  console.log();
  console.log('These could be checked manually at:');
  console.log('  https://gamma-api.polymarket.com/markets?id={condition_id}');

  await client.close();
}

main().catch(console.error);
