/**
 * Investigate data duplication in CLOB events
 *
 * Problem: CLOB sells are 2x buys for @cozyfnf, suggesting duplicate data
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  const wallet = '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd';
  console.log(`\n=== Investigating data duplication for @cozyfnf ===`);
  console.log(`Wallet: ${wallet}\n`);

  // 1. Check for duplicate event_ids
  console.log('1. Checking for duplicate event_ids in dedup table...');
  const dupCheck = await client.query({
    query: `
      SELECT
        event_id,
        count() as cnt
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
      HAVING cnt > 1
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const dups = await dupCheck.json() as any[];
  console.log('   Duplicate event_ids:', dups.length > 0 ? `Found ${dups.length}!` : 'None found ✓');

  // 2. Raw count vs distinct count
  console.log('\n2. Checking event counts...');
  const countCheck = await client.query({
    query: `
      SELECT
        count() as raw_count,
        count(DISTINCT event_id) as distinct_events
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const counts = await countCheck.json() as any[];
  console.log('   Raw count:', counts[0].raw_count);
  console.log('   Distinct events:', counts[0].distinct_events);
  if (counts[0].raw_count !== counts[0].distinct_events) {
    console.log('   ⚠️ DUPLICATES DETECTED!');
  }

  // 3. Check side breakdown
  console.log('\n3. Checking side breakdown...');
  const sideCheck = await client.query({
    query: `
      SELECT
        side,
        count() as cnt,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY side
      ORDER BY side
    `,
    format: 'JSONEachRow'
  });
  const sides = await sideCheck.json() as any[];
  console.log('\n   Side | Count | USDC | Tokens');
  console.log('   ' + '-'.repeat(60));
  for (const row of sides) {
    console.log(`   ${row.side.padEnd(4)} | ${String(row.cnt).padStart(5)} | $${Number(row.total_usdc).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(12)} | ${Number(row.total_tokens).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(12)}`);
  }

  // 4. Compare with v2 table (before dedup)
  console.log('\n4. Checking pm_trader_events_v2 (raw)...');
  const rawCheck = await client.query({
    query: `
      SELECT
        count() as raw_count,
        count(DISTINCT event_id) as distinct_events
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const rawCounts = await rawCheck.json() as any[];
  console.log('   Raw count:', rawCounts[0].raw_count);
  console.log('   Distinct events:', rawCounts[0].distinct_events);

  // 5. Check DISTINCT trade breakdown (deduplicated)
  console.log('\n5. Checking DISTINCT trades (deduplicated)...');
  const tradeBreakdown = await client.query({
    query: `
      SELECT
        side,
        count() as trade_count,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount, any(token_amount) as token_amount
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      )
      GROUP BY side
    `,
    format: 'JSONEachRow'
  });
  const breakdown = await tradeBreakdown.json() as any[];
  console.log('\n   Side | Distinct Trades | Total USDC | Total Tokens');
  console.log('   ' + '-'.repeat(60));
  for (const row of breakdown) {
    console.log(`   ${row.side.padEnd(4)} | ${String(row.trade_count).padStart(15)} | $${Number(row.total_usdc).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(12)} | ${Number(row.total_tokens).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(12)}`);
  }

  // 6. Check for net cash flow accounting (should equal UI approximately)
  console.log('\n6. Net cash flow calculation...');
  const cashFlow = await client.query({
    query: `
      SELECT
        sumIf(usdc_amount, side = 'SELL') / 1e6 as sell_usdc,
        sumIf(usdc_amount, side = 'BUY') / 1e6 as buy_usdc,
        (sumIf(usdc_amount, side = 'SELL') - sumIf(usdc_amount, side = 'BUY')) / 1e6 as net_cash_flow
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const cf = await cashFlow.json() as any[];
  console.log(`   Total SELL USDC: $${Number(cf[0].sell_usdc).toLocaleString()}`);
  console.log(`   Total BUY USDC:  $${Number(cf[0].buy_usdc).toLocaleString()}`);
  console.log(`   Net cash flow:   $${Number(cf[0].net_cash_flow).toLocaleString()}`);
  console.log(`   UI PnL:          $1,409,524.60`);

  // 7. Check redemptions separately
  console.log('\n7. Checking redemptions...');
  const redemptions = await client.query({
    query: `
      SELECT
        count() as redemption_count,
        sum(payout) / 1e6 as total_payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const red = await redemptions.json() as any[];
  console.log(`   Redemption count: ${red[0]?.redemption_count || 0}`);
  console.log(`   Total payout:     $${Number(red[0]?.total_payout || 0).toLocaleString()}`);

  await client.close();
}

main().catch(console.error);
