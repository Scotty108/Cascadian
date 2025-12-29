#!/usr/bin/env npx tsx
/**
 * SAMPLE ANALYSIS: pm_trader_events_v2 structure
 *
 * Use a single wallet to understand the maker/taker pattern
 * without hitting memory limits.
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
  request_timeout: 60000,
});

// Use one of our Dome validation wallets
const TEST_WALLET = '0x6b0096aaf2402b7ba836a6b51e5c25c9d8c93874';

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('SAMPLE ANALYSIS: pm_trader_events_v2 STRUCTURE');
  console.log('='.repeat(80));
  console.log(`Test wallet: ${TEST_WALLET}\n`);

  // 1. Get counts by role for this wallet
  console.log('1. ROLE DISTRIBUTION FOR THIS WALLET:');
  const roleResult = await clickhouse.query({
    query: `
      SELECT
        role,
        count() as row_count,
        countDistinct(event_id) as unique_events
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${TEST_WALLET}'
        AND is_deleted = 0
      GROUP BY role
    `,
    format: 'JSONEachRow',
  });
  const roleData = await roleResult.json<any[]>();
  for (const row of roleData) {
    console.log(`   ${row.role}: ${row.row_count} rows, ${row.unique_events} unique events`);
  }

  // 2. Check if any event_id appears in BOTH maker and taker for same wallet
  console.log('\n2. SELF-TRADE CHECK (same wallet as both maker & taker):');
  const selfTradeResult = await clickhouse.query({
    query: `
      SELECT count() as self_trade_count
      FROM (
        SELECT event_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${TEST_WALLET}'
          AND is_deleted = 0
        GROUP BY event_id
        HAVING countDistinct(role) > 1
      )
    `,
    format: 'JSONEachRow',
  });
  const selfTrade = await selfTradeResult.json<{ self_trade_count: string }[]>();
  console.log(`   Events where wallet is BOTH maker and taker: ${selfTrade[0]?.self_trade_count || 0}`);

  // 3. Check for true duplicates (same event_id, same role, multiple rows)
  console.log('\n3. TRUE DUPLICATES CHECK (same event + same role, multiple rows):');
  const trueDupeResult = await clickhouse.query({
    query: `
      SELECT count() as dupe_count
      FROM (
        SELECT event_id, role, count() as cnt
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${TEST_WALLET}'
          AND is_deleted = 0
        GROUP BY event_id, role
        HAVING cnt > 1
      )
    `,
    format: 'JSONEachRow',
  });
  const trueDupe = await trueDupeResult.json<{ dupe_count: string }[]>();
  const dupeCount = parseInt(trueDupe[0]?.dupe_count || '0');
  console.log(`   True duplicates (same event+role, multiple rows): ${dupeCount}`);

  if (dupeCount > 0) {
    console.log('\n   Sample duplicates:');
    const sampleDupeResult = await clickhouse.query({
      query: `
        SELECT event_id, role, count() as cnt
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${TEST_WALLET}'
          AND is_deleted = 0
        GROUP BY event_id, role
        HAVING cnt > 1
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const sampleDupe = await sampleDupeResult.json<any[]>();
    for (const row of sampleDupe) {
      console.log(`     Event: ${row.event_id.slice(0, 40)}... Role: ${row.role} Count: ${row.cnt}`);
    }
  }

  // 4. Show what proper deduplication looks like
  console.log('\n4. PROPER DEDUPLICATION PATTERN:');
  console.log('   For PnL, we should query with GROUP BY event_id:');

  const dedupedResult = await clickhouse.query({
    query: `
      SELECT
        count() as raw_rows,
        countDistinct(event_id) as after_event_dedup,
        sum(usdc_amount) / 1e6 as raw_usdc_total,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${TEST_WALLET}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const deduped = await dedupedResult.json<any[]>();
  const d = deduped[0];
  console.log(`   Raw rows: ${d.raw_rows}`);
  console.log(`   Unique events: ${d.after_event_dedup}`);
  console.log(`   Raw USDC total: $${parseFloat(d.raw_usdc_total).toFixed(2)}`);

  // 5. Properly deduplicated calculation
  console.log('\n5. DEDUPLICATED USDC (using GROUP BY event_id):');
  const properResult = await clickhouse.query({
    query: `
      SELECT
        sumIf(usdc, side = 'buy') as buy_usdc,
        sumIf(usdc, side = 'sell') as sell_usdc,
        sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as net_cash_flow
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount) / 1e6 as usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${TEST_WALLET}'
          AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });
  const proper = await properResult.json<any[]>();
  const p = proper[0];
  console.log(`   Buy USDC:       $${parseFloat(p.buy_usdc).toFixed(2)}`);
  console.log(`   Sell USDC:      $${parseFloat(p.sell_usdc).toFixed(2)}`);
  console.log(`   Net Cash Flow:  $${parseFloat(p.net_cash_flow).toFixed(2)}`);

  // Conclusion
  console.log('\n='.repeat(80));
  console.log('UNDERSTANDING');
  console.log('='.repeat(80));
  console.log(`
KEY INSIGHT: pm_trader_events_v2 has ~2 rows per event_id across the whole table
because each trade has a maker and taker (usually DIFFERENT wallets).

For a SINGLE WALLET:
- Each event_id should appear ONCE (either as maker OR taker)
- Self-trades (same wallet as both) are rare
- TRUE duplicates (same event+role, multiple rows) are from backfill issues

THE FIX: When building pm_unified_ledger, we should:
1. Include BOTH maker AND taker rows (not filter by role)
2. Dedupe by (event_id, trader_wallet) to handle any backfill duplicates
3. This gives each wallet their complete trade history

The role='maker' filter was wrong because it excluded taker trades.
But we need to be careful not to double-count during the fix.
`);

  await clickhouse.close();
}

main().catch(console.error);
