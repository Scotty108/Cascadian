/**
 * Inventory Conservation Check
 *
 * Tests whether a wallet's ledger is inventory-conserving.
 * If tokens go negative, the ledger is missing events.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a'; // darkrider11

interface LedgerTable {
  name: string;
  walletCol: string;
  tokenCol: string;
  typeCol?: string;
  tsCol: string;
}

const LEDGER_TABLES: LedgerTable[] = [
  { name: 'pm_unified_ledger_v7', walletCol: 'wallet_address', tokenCol: 'token_delta', typeCol: 'source_type', tsCol: 'event_timestamp' },
  { name: 'pm_unified_ledger_v8_tbl', walletCol: 'wallet_address', tokenCol: 'token_delta', typeCol: 'source_type', tsCol: 'event_timestamp' },
  { name: 'pm_unified_ledger_v9_clob_tbl', walletCol: 'wallet_address', tokenCol: 'token_delta', typeCol: 'source_type', tsCol: 'event_timestamp' },
];

async function checkInventoryConservation(table: LedgerTable, wallet: string) {
  console.log(`\n=== ${table.name} ===`);

  // 1. Check for negative inventory positions
  console.log('\n1. Negative Inventory Positions (tokens < 0):');
  try {
    const negQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          outcome_index,
          sum(${table.tokenCol}) AS net_tokens
        FROM ${table.name}
        WHERE lower(${table.walletCol}) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
        HAVING net_tokens < -1  -- Allow small rounding errors
        ORDER BY net_tokens ASC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const negRows = await negQuery.json() as any[];
    if (negRows.length === 0) {
      console.log('  ✓ No negative positions found - inventory conserves!');
    } else {
      console.log(`  ✗ Found ${negRows.length} negative positions:`);
      for (const r of negRows) {
        console.log(`    ${r.condition_id.slice(0, 16)}... outcome=${r.outcome_index} tokens=${Number(r.net_tokens).toLocaleString()}`);
      }
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.message?.slice(0, 100)}`);
  }

  // 2. Event type distribution
  if (table.typeCol) {
    console.log('\n2. Event Type Distribution:');
    try {
      const typeQuery = await clickhouse.query({
        query: `
          SELECT
            ${table.typeCol} as type,
            count() as cnt,
            sum(usdc_delta) as total_usdc,
            sum(${table.tokenCol}) as total_tokens
          FROM ${table.name}
          WHERE lower(${table.walletCol}) = lower('${wallet}')
          GROUP BY ${table.typeCol}
          ORDER BY cnt DESC
        `,
        format: 'JSONEachRow'
      });
      const typeRows = await typeQuery.json() as any[];
      for (const r of typeRows) {
        console.log(`  ${r.type}: ${r.cnt} events, USDC=${Number(r.total_usdc).toLocaleString()}, tokens=${Number(r.total_tokens).toLocaleString()}`);
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message?.slice(0, 100)}`);
    }
  }

  // 3. Time coverage
  console.log('\n3. Time Coverage:');
  try {
    const timeQuery = await clickhouse.query({
      query: `
        SELECT
          min(${table.tsCol}) as min_ts,
          max(${table.tsCol}) as max_ts,
          count() as total_events,
          countDistinct(condition_id) as unique_conditions
        FROM ${table.name}
        WHERE lower(${table.walletCol}) = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });
    const timeRows = await timeQuery.json() as any[];
    if (timeRows.length > 0) {
      const r = timeRows[0];
      console.log(`  First event: ${r.min_ts}`);
      console.log(`  Last event:  ${r.max_ts}`);
      console.log(`  Total events: ${r.total_events}`);
      console.log(`  Unique conditions: ${r.unique_conditions}`);
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.message?.slice(0, 100)}`);
  }

  // 4. Payout/Redemption check
  console.log('\n4. Payout/Redemption Events:');
  try {
    const payoutQuery = await clickhouse.query({
      query: `
        SELECT
          countIf(${table.typeCol} ILIKE '%redeem%' OR ${table.typeCol} ILIKE '%payout%') AS payout_events,
          sumIf(usdc_delta, ${table.typeCol} ILIKE '%redeem%' OR ${table.typeCol} ILIKE '%payout%') AS payout_usdc
        FROM ${table.name}
        WHERE lower(${table.walletCol}) = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });
    const payoutRows = await payoutQuery.json() as any[];
    if (payoutRows.length > 0) {
      const r = payoutRows[0];
      console.log(`  Payout events: ${r.payout_events}`);
      console.log(`  Payout USDC: $${Number(r.payout_usdc).toLocaleString()}`);
      if (r.payout_events > 0) {
        console.log('  ⚠️  Real payout events exist - do NOT add synthetic redemptions');
      }
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.message?.slice(0, 100)}`);
  }
}

async function main() {
  console.log(`\n========================================`);
  console.log(`Inventory Conservation Check for: ${WALLET.slice(0, 10)}...`);
  console.log(`========================================`);

  for (const table of LEDGER_TABLES) {
    await checkInventoryConservation(table, WALLET);
  }

  // Also check raw pm_trader_events_v2
  console.log(`\n=== pm_trader_events_v2 (Raw CLOB) ===`);
  console.log('\n1. Negative Inventory Positions:');
  try {
    const rawQuery = await clickhouse.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(token_amount) / 1000000.0 as tokens
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
          GROUP BY event_id
        ),
        positions AS (
          SELECT
            token_id,
            sum(if(side = 'buy', tokens, -tokens)) as net_tokens
          FROM deduped
          GROUP BY token_id
        )
        SELECT token_id, net_tokens
        FROM positions
        WHERE net_tokens < -1
        ORDER BY net_tokens ASC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const rawRows = await rawQuery.json() as any[];
    if (rawRows.length === 0) {
      console.log('  ✓ No negative positions in raw CLOB');
    } else {
      console.log(`  ✗ Found ${rawRows.length} negative positions in CLOB-only:`);
      for (const r of rawRows) {
        console.log(`    token=${r.token_id.slice(0, 20)}... tokens=${Number(r.net_tokens).toLocaleString()}`);
      }
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.message?.slice(0, 100)}`);
  }

  console.log('\n');
}

main().catch(console.error);
