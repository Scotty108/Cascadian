#!/usr/bin/env npx tsx
/**
 * CREATE NORMALIZED TRADER EVENTS VIEW V2
 *
 * Improved version with:
 * 1. Tighter dedupe key: (event_id, trader_wallet, role)
 * 2. Deterministic picking: argMax/argMin for stability
 * 3. Leaves original table completely untouched
 *
 * NON-DESTRUCTIVE: Creates a new view, does not modify any existing data.
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const VIEW_NAME = 'vw_pm_trader_events_wallet_dedup_v2';

async function main() {
  console.log('='.repeat(80));
  console.log('CREATE NORMALIZED TRADER EVENTS VIEW V2 (NON-DESTRUCTIVE)');
  console.log('='.repeat(80));
  console.log('Key: (event_id, trader_wallet, role)');
  console.log('Picking: Deterministic using min(insert_time) as tiebreaker');

  // Step 1: Drop existing view if it exists
  console.log('\n1. Dropping existing view if present...');
  try {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${VIEW_NAME}` });
    console.log('   Done');
  } catch {
    console.log('   View did not exist');
  }

  // Step 2: Create the normalized view with tighter key
  console.log('\n2. Creating normalized view...');
  const createViewSQL = `
    CREATE VIEW ${VIEW_NAME} AS
    SELECT
      event_id,
      trader_wallet,
      role,
      -- Use argMin to pick values from the row with earliest insert_time (deterministic)
      argMin(side, insert_time) AS side,
      argMin(token_id, insert_time) AS token_id,
      argMin(usdc_amount, insert_time) AS usdc_amount,
      argMin(token_amount, insert_time) AS token_amount,
      argMin(fee_amount, insert_time) AS fee_amount,
      min(trade_time) AS trade_time,
      argMin(transaction_hash, insert_time) AS transaction_hash,
      argMin(block_number, insert_time) AS block_number
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY event_id, trader_wallet, role
  `;

  await clickhouse.command({ query: createViewSQL });
  console.log(`   ✅ Created view: ${VIEW_NAME}`);

  // Step 3: Verify the view
  console.log('\n3. Verifying view...');

  const testWallet = '0xe1b40c6772bd0d57597ae00cae4df34e70bf46ac';

  // Raw stats
  const rawQuery = `
    SELECT
      count() as raw_rows,
      countDistinct(event_id, trader_wallet, role) as unique_event_wallet_role
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${testWallet}' AND is_deleted = 0
  `;
  const rawResult = await clickhouse.query({ query: rawQuery, format: 'JSONEachRow' });
  const rawRow = (await rawResult.json<any[]>())[0];

  // View stats
  const viewQuery = `SELECT count() as view_rows FROM ${VIEW_NAME} WHERE trader_wallet = '${testWallet}'`;
  const viewResult = await clickhouse.query({ query: viewQuery, format: 'JSONEachRow' });
  const viewRow = (await viewResult.json<any[]>())[0];

  console.log(`\n   Test wallet: ${testWallet}`);
  console.log(`   Raw table rows:              ${rawRow.raw_rows}`);
  console.log(`   Unique (event, wallet, role): ${rawRow.unique_event_wallet_role}`);
  console.log(`   View rows:                   ${viewRow.view_rows}`);
  console.log(`   Dedup successful:            ${Number(viewRow.view_rows) === Number(rawRow.unique_event_wallet_role) ? '✅' : '❌'}`);
  console.log(`   Rows eliminated:             ${Number(rawRow.raw_rows) - Number(viewRow.view_rows)}`);

  // Step 4: Compare V1 vs V2
  console.log('\n4. Comparing V1 vs V2 views:');
  const v1Query = `SELECT count() as cnt FROM vw_pm_trader_events_wallet_dedup_v1 WHERE trader_wallet = '${testWallet}'`;
  try {
    const v1Result = await clickhouse.query({ query: v1Query, format: 'JSONEachRow' });
    const v1Row = (await v1Result.json<any[]>())[0];
    console.log(`   V1 (event_id, wallet):       ${v1Row.cnt} rows`);
    console.log(`   V2 (event_id, wallet, role): ${viewRow.view_rows} rows`);
    console.log(`   Difference:                  ${Number(viewRow.view_rows) - Number(v1Row.cnt)}`);
  } catch {
    console.log('   V1 view not found for comparison');
  }

  console.log('\n' + '='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
  console.log(`
The V2 view uses a tighter key (event_id, trader_wallet, role) and
deterministic picking via argMin(..., insert_time).

This ensures:
1. No accidental collapse of real maker/taker rows for same wallet
2. Stable results across query runs
3. Safe handling of re-ingestion duplicates

Original pm_trader_events_v2 is UNCHANGED.
`);

  await clickhouse.close();
}

main();
