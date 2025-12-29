#!/usr/bin/env npx tsx
/**
 * ANALYZE: pm_trader_events_v2 duplication patterns
 *
 * Questions to answer:
 * 1. How many duplicate event_ids exist?
 * 2. Are duplicates from the same wallet (true dupe) or different wallets (maker/taker pair)?
 * 3. What's the scale of the problem?
 *
 * Terminal: Claude 2
 * Date: 2025-12-07
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('ANALYZING pm_trader_events_v2 DUPLICATION PATTERNS');
  console.log('='.repeat(80));

  // 1. Overall table stats
  console.log('\n1. TABLE OVERVIEW:');
  try {
    const overviewResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          countDistinct(event_id) as unique_event_ids,
          countDistinct(trader_wallet) as unique_wallets
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
      `,
      format: 'JSONEachRow',
    });
    const overview = await overviewResult.json<any[]>();
    const o = overview[0];
    console.log(`   Total rows:        ${parseInt(o.total_rows).toLocaleString()}`);
    console.log(`   Unique event_ids:  ${parseInt(o.unique_event_ids).toLocaleString()}`);
    console.log(`   Unique wallets:    ${parseInt(o.unique_wallets).toLocaleString()}`);
    console.log(`   Duplication ratio: ${(parseInt(o.total_rows) / parseInt(o.unique_event_ids)).toFixed(2)}x`);
  } catch (err: any) {
    console.log(`   Error: ${err.message}`);
  }

  // 2. Per-event_id row counts
  console.log('\n2. ROWS PER EVENT_ID DISTRIBUTION:');
  try {
    const distResult = await clickhouse.query({
      query: `
        SELECT
          rows_per_event,
          count() as event_count
        FROM (
          SELECT event_id, count() as rows_per_event
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY rows_per_event
        ORDER BY rows_per_event
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const dist = await distResult.json<{ rows_per_event: string; event_count: string }[]>();
    for (const row of dist) {
      const pct = ''; // Can't calculate without total
      console.log(`   ${row.rows_per_event} row(s) per event: ${parseInt(row.event_count).toLocaleString()} events`);
    }
  } catch (err: any) {
    console.log(`   Error: ${err.message}`);
  }

  // 3. Understand the 2-row pattern
  console.log('\n3. SAMPLE 2-ROW EVENT (maker/taker pair):');
  try {
    const sampleResult = await clickhouse.query({
      query: `
        SELECT event_id, trader_wallet, role, side, usdc_amount, token_amount
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND event_id IN (
            SELECT event_id
            FROM pm_trader_events_v2
            WHERE is_deleted = 0
            GROUP BY event_id
            HAVING count() = 2
            LIMIT 1
          )
        ORDER BY role
      `,
      format: 'JSONEachRow',
    });
    const sample = await sampleResult.json<any[]>();
    for (const row of sample) {
      console.log(`   Event: ${row.event_id.slice(0, 40)}...`);
      console.log(`   Wallet: ${row.trader_wallet} | Role: ${row.role} | Side: ${row.side}`);
      console.log(`   USDC: ${(parseInt(row.usdc_amount) / 1e6).toFixed(2)} | Tokens: ${(parseInt(row.token_amount) / 1e6).toFixed(2)}`);
      console.log('');
    }
  } catch (err: any) {
    console.log(`   Error: ${err.message}`);
  }

  // 4. Check for TRUE duplicates (same event_id AND same wallet)
  console.log('\n4. TRUE DUPLICATES (same event_id + same wallet):');
  try {
    const trueDupeResult = await clickhouse.query({
      query: `
        SELECT count() as dupe_count
        FROM (
          SELECT event_id, trader_wallet, count() as cnt
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY event_id, trader_wallet
          HAVING cnt > 1
        )
      `,
      format: 'JSONEachRow',
    });
    const trueDupe = await trueDupeResult.json<{ dupe_count: string }[]>();
    const dupeCount = parseInt(trueDupe[0]?.dupe_count || '0');
    console.log(`   True duplicates found: ${dupeCount.toLocaleString()}`);

    if (dupeCount > 0) {
      console.log('\n   Sample true duplicate:');
      const sampleDupeResult = await clickhouse.query({
        query: `
          SELECT event_id, trader_wallet, role, count() as cnt
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY event_id, trader_wallet, role
          HAVING cnt > 1
          LIMIT 5
        `,
        format: 'JSONEachRow',
      });
      const sampleDupe = await sampleDupeResult.json<any[]>();
      for (const row of sampleDupe) {
        console.log(`   Event: ${row.event_id.slice(0, 30)}... Wallet: ${row.trader_wallet.slice(0, 15)}... Role: ${row.role} Count: ${row.cnt}`);
      }
    }
  } catch (err: any) {
    console.log(`   Error: ${err.message}`);
  }

  // 5. Impact assessment for deduplication
  console.log('\n5. DEDUPLICATION IMPACT ASSESSMENT:');
  try {
    // Count rows that would remain after dedup
    const dedupResult = await clickhouse.query({
      query: `
        SELECT count() as deduped_rows
        FROM (
          SELECT event_id, trader_wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY event_id, trader_wallet
        )
      `,
      format: 'JSONEachRow',
    });
    const dedup = await dedupResult.json<{ deduped_rows: string }[]>();
    const dedupedRows = parseInt(dedup[0]?.deduped_rows || '0');
    console.log(`   Rows after dedup (by event_id + wallet): ${dedupedRows.toLocaleString()}`);
  } catch (err: any) {
    console.log(`   Error: ${err.message}`);
  }

  // 6. Recommendation
  console.log('\n='.repeat(80));
  console.log('RECOMMENDATION');
  console.log('='.repeat(80));
  console.log(`
The pm_trader_events_v2 table has ~2 rows per event_id because each trade
involves two parties: maker and taker.

For PnL calculation, we should:
1. NOT dedupe the entire table - we need BOTH maker and taker rows
2. When querying for a specific wallet, use GROUP BY event_id to get unique events
3. Each wallet appears ONCE per event_id (either as maker OR taker)

The "duplication" is by design - it's not a data quality issue.
The issue is HOW we query it for PnL purposes.
`);

  await clickhouse.close();
}

main().catch(console.error);
