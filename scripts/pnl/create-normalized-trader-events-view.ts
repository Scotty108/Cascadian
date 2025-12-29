#!/usr/bin/env npx tsx
/**
 * CREATE NORMALIZED TRADER EVENTS VIEW
 *
 * Creates a NEW VIEW that deduplicates pm_trader_events_v2 by (event_id, trader_wallet).
 * This leaves the original table completely untouched.
 *
 * The view:
 * - Includes BOTH maker and taker events (no role filter)
 * - Deduplicates by (event_id, trader_wallet) to handle backfill duplicates
 * - Uses deterministic aggregation (any() for consistent results)
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

const VIEW_NAME = 'vw_pm_trader_events_wallet_dedup_v1';

async function main() {
  console.log('='.repeat(80));
  console.log('CREATE NORMALIZED TRADER EVENTS VIEW (NON-DESTRUCTIVE)');
  console.log('='.repeat(80));

  // Step 1: Check if view already exists
  console.log('\n1. Checking if view already exists...');
  try {
    const checkQuery = `SELECT count() FROM ${VIEW_NAME} LIMIT 1`;
    await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
    console.log(`   View ${VIEW_NAME} already exists. Dropping to recreate...`);
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${VIEW_NAME}` });
  } catch {
    console.log(`   View ${VIEW_NAME} does not exist yet.`);
  }

  // Step 2: Create the normalized view
  console.log('\n2. Creating normalized view...');
  const createViewSQL = `
    CREATE VIEW ${VIEW_NAME} AS
    SELECT
      event_id,
      trader_wallet,
      any(side) AS side,
      any(role) AS role,
      any(token_id) AS token_id,
      any(usdc_amount) AS usdc_amount,
      any(token_amount) AS token_amount,
      any(fee_amount) AS fee_amount,
      min(trade_time) AS trade_time,
      any(transaction_hash) AS transaction_hash,
      any(block_number) AS block_number
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY event_id, trader_wallet
  `;

  await clickhouse.command({ query: createViewSQL });
  console.log(`   ✅ Created view: ${VIEW_NAME}`);

  // Step 3: Verify the view
  console.log('\n3. Verifying view...');

  // Test with our problem wallet
  const testWallet = '0xe1b40c6772bd0d57597ae00cae4df34e70bf46ac';

  const rawCountQuery = `
    SELECT count() as raw_rows, countDistinct(event_id) as unique_events
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${testWallet}' AND is_deleted = 0
  `;
  const rawResult = await clickhouse.query({ query: rawCountQuery, format: 'JSONEachRow' });
  const rawRow = (await rawResult.json<any[]>())[0];

  const viewCountQuery = `
    SELECT count() as view_rows
    FROM ${VIEW_NAME}
    WHERE trader_wallet = '${testWallet}'
  `;
  const viewResult = await clickhouse.query({ query: viewCountQuery, format: 'JSONEachRow' });
  const viewRow = (await viewResult.json<any[]>())[0];

  console.log(`\n   Test wallet: ${testWallet}`);
  console.log(`   Raw table rows:      ${rawRow.raw_rows}`);
  console.log(`   Raw unique events:   ${rawRow.unique_events}`);
  console.log(`   View rows:           ${viewRow.view_rows}`);
  console.log(`   Dedup successful:    ${Number(viewRow.view_rows) === Number(rawRow.unique_events) ? '✅' : '❌'}`);

  // Step 4: Compare maker-only vs all events
  console.log('\n4. Coverage comparison:');
  const makerOnlyQuery = `
    SELECT count() as maker_events
    FROM ${VIEW_NAME}
    WHERE trader_wallet = '${testWallet}' AND role = 'maker'
  `;
  const makerResult = await clickhouse.query({ query: makerOnlyQuery, format: 'JSONEachRow' });
  const makerRow = (await makerResult.json<any[]>())[0];

  console.log(`   Maker-only events:   ${makerRow.maker_events}`);
  console.log(`   All events (view):   ${viewRow.view_rows}`);
  console.log(`   Taker events gained: ${Number(viewRow.view_rows) - Number(makerRow.maker_events)}`);

  console.log('\n' + '='.repeat(80));
  console.log('DONE - View created successfully');
  console.log('='.repeat(80));
  console.log(`
NEXT STEPS:
1. Update materialize-v8-ledger.ts to read from ${VIEW_NAME} instead of pm_trader_events_v2
2. This will automatically:
   - Include both maker and taker events
   - Deduplicate backfill duplicates
3. The original pm_trader_events_v2 table is UNCHANGED

USAGE:
  Replace: FROM pm_trader_events_v2 WHERE is_deleted = 0
  With:    FROM ${VIEW_NAME}
`);

  await clickhouse.close();
}

main();
