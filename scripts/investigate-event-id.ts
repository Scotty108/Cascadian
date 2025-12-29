/**
 * Investigate what event_id represents and verify data integrity
 *
 * Questions to answer:
 * 1. Is event_id a unique match ID or an aggregation key?
 * 2. Does the same wallet ever appear as both maker AND taker on same event_id?
 * 3. What does a typical event_id look like (hash? composite key?)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('=== INVESTIGATING event_id STRUCTURE ===\n');

  // 1. Sample event_ids to understand format
  console.log('1. Sample event_ids (what do they look like?)...');
  const sampleIds = await clickhouse.query({
    query: `
      SELECT DISTINCT event_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 7 DAY
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleIdRows = await sampleIds.json() as any[];
  console.log('Sample event_ids:');
  sampleIdRows.forEach((r: any) => console.log(`  ${r.event_id}`));

  // 2. How many rows per event_id?
  console.log('\n2. Row distribution per event_id (last 7d)...');
  const rowDist = await clickhouse.query({
    query: `
      SELECT
        rows_per_event,
        count() as num_events
      FROM (
        SELECT event_id, count() as rows_per_event
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 7 DAY
        GROUP BY event_id
      )
      GROUP BY rows_per_event
      ORDER BY rows_per_event
    `,
    format: 'JSONEachRow'
  });
  console.log('Rows per event_id:');
  const rowDistRows = await rowDist.json() as any[];
  rowDistRows.forEach((r: any) => console.log(`  ${r.rows_per_event} rows: ${Number(r.num_events).toLocaleString()} events`));

  // 3. For event_ids with 2 rows: are they always maker+taker pair?
  console.log('\n3. Events with 2 rows - what roles do they have?...');
  const twoRowEvents = await clickhouse.query({
    query: `
      SELECT
        groupArray(role) as roles,
        count() as num_events
      FROM (
        SELECT event_id, groupArray(role) as roles
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 7 DAY
        GROUP BY event_id
        HAVING count() = 2
      )
      GROUP BY roles
      ORDER BY num_events DESC
    `,
    format: 'JSONEachRow'
  });
  console.log('Role combinations for 2-row events:');
  const twoRowRows = await twoRowEvents.json() as any[];
  twoRowRows.forEach((r: any) => console.log(`  ${JSON.stringify(r.roles)}: ${Number(r.num_events).toLocaleString()} events`));

  // 4. CRITICAL: Does the same wallet ever appear as BOTH maker AND taker on same event_id?
  console.log('\n4. CRITICAL: Same wallet as both maker AND taker on same event_id?...');
  const selfTrade = await clickhouse.query({
    query: `
      SELECT count() as self_trade_count
      FROM (
        SELECT event_id, trader_wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 30 DAY
        GROUP BY event_id, trader_wallet
        HAVING countDistinct(role) > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const selfTradeRows = await selfTrade.json() as any[];
  console.log('Self-trade or bug count:', selfTradeRows[0]);

  // 5. If self-trades exist, show examples
  if (Number(selfTradeRows[0]?.self_trade_count) > 0) {
    console.log('\n5. Sample self-trade/bug cases...');
    const selfTradeExamples = await clickhouse.query({
      query: `
        SELECT
          event_id,
          trader_wallet,
          groupArray(role) as roles,
          groupArray(side) as sides,
          groupArray(usdc_amount / 1e6) as usdc_amounts
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 30 DAY
          AND (event_id, trader_wallet) IN (
            SELECT event_id, trader_wallet
            FROM pm_trader_events_v2
            WHERE is_deleted = 0
              AND trade_time >= now() - INTERVAL 30 DAY
            GROUP BY event_id, trader_wallet
            HAVING countDistinct(role) > 1
          )
        GROUP BY event_id, trader_wallet
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const examples = await selfTradeExamples.json() as any[];
    examples.forEach((r: any) => {
      console.log(`  event_id: ${r.event_id}`);
      console.log(`    wallet: ${r.trader_wallet}`);
      console.log(`    roles: ${JSON.stringify(r.roles)}`);
      console.log(`    sides: ${JSON.stringify(r.sides)}`);
      console.log(`    amounts: ${JSON.stringify(r.usdc_amounts)}`);
    });
  }

  // 6. Check if event_id matches transaction_hash pattern
  console.log('\n6. Comparing event_id vs transaction_hash...');
  const hashCompare = await clickhouse.query({
    query: `
      SELECT
        event_id,
        transaction_hash,
        event_id = transaction_hash as matches
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 1 DAY
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const hashRows = await hashCompare.json() as any[];
  console.log('event_id vs transaction_hash:');
  hashRows.forEach((r: any) => console.log(`  event_id: ${r.event_id}\n  tx_hash:  ${r.transaction_hash}\n  matches: ${r.matches}\n`));

  // 7. For a single event_id, show all rows
  console.log('7. Full details for one event_id with 2 rows...');
  const singleEvent = await clickhouse.query({
    query: `
      WITH sample_event AS (
        SELECT event_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 1 DAY
        GROUP BY event_id
        HAVING count() = 2
        LIMIT 1
      )
      SELECT
        event_id,
        trader_wallet,
        role,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        token_id,
        transaction_hash
      FROM pm_trader_events_v2
      WHERE event_id IN (SELECT event_id FROM sample_event)
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const singleRows = await singleEvent.json() as any[];
  console.log('Sample 2-row event:');
  singleRows.forEach((r: any) => {
    console.log(`  wallet: ${r.trader_wallet}`);
    console.log(`  role: ${r.role}, side: ${r.side}`);
    console.log(`  usdc: $${r.usdc}, tokens: ${r.tokens}`);
    console.log(`  token_id: ${r.token_id.slice(0, 20)}...`);
    console.log(`  tx_hash: ${r.transaction_hash}`);
    console.log('');
  });

  // 8. Summary
  console.log('=== SUMMARY ===');
  console.log(`
Based on the investigation:

1. event_id format: [describe what we found]
2. Rows per event_id: [mostly 2, meaning maker+taker pairs]
3. Self-trade cases: [count found]
4. event_id vs tx_hash: [are they the same or different?]

CONCLUSION:
- If event_id IS the unique trade/match ID from Polymarket, then same wallet as both roles is a bug
- If event_id is an aggregation key (like tx_hash), then it's expected behavior
  `);
}

main().catch(console.error);
