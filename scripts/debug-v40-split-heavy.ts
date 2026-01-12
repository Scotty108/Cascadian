/**
 * Debug script to trace V40 logic for SPLIT_HEAVY on a single condition
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba';
// Using a simple condition: [2] redemption with [0,1] resolution
const TEST_CONDITION = 'c4f8f4b8b268e142a65ab2c9bd78b4f21609122af58d17d728518118fc416e5a';

async function main() {
  console.log('═'.repeat(80));
  console.log('🔍 V40 Debug: SPLIT_HEAVY - Single Condition Trace');
  console.log('═'.repeat(80));
  console.log(`\nCondition: ${TEST_CONDITION}`);

  // 1. Get CTF events for this condition
  console.log('\n1. CTF Events:');
  const ctfQuery = `
    SELECT
      event_type,
      partition_index_sets,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      count() as cnt
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET.toLowerCase()}'
      AND lower(condition_id) = '${TEST_CONDITION}'
      AND is_deleted = 0
    GROUP BY event_type, partition_index_sets, amount
    ORDER BY event_type, amount DESC
    LIMIT 10
  `;
  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];
  console.table(ctfRows);

  // 2. Get resolution prices
  console.log('\n2. Resolution Prices:');
  const resQuery = `
    SELECT norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) = '${TEST_CONDITION}'
      AND is_deleted = 0
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];
  console.log('   norm_prices:', resRows[0]?.norm_prices || 'NOT FOUND');

  // 3. Parse partition_index_sets manually
  console.log('\n3. Parsing partition_index_sets:');
  for (const row of ctfRows) {
    const parsed = JSON.parse(row.partition_index_sets || '[]');
    const outcomes = parsed.map((p: number) => p - 1); // 1-indexed to 0-indexed
    console.log(`   ${row.event_type} ${row.partition_index_sets} → outcomes: ${JSON.stringify(outcomes)}`);
  }

  // 4. Manual PnL calculation
  console.log('\n4. Manual PnL Calculation:');
  const resolution = resRows[0]?.norm_prices || [0, 1];

  // Sum up splits and redemptions
  let splitTotal = 0;
  let redeemTotal_O0 = 0;
  let redeemTotal_O1 = 0;

  for (const row of ctfRows) {
    if (row.event_type === 'PositionSplit') {
      splitTotal += row.amount * row.cnt;
    } else if (row.event_type === 'PayoutRedemption') {
      const parsed = JSON.parse(row.partition_index_sets || '[]');
      for (const p of parsed) {
        if (p === 1) redeemTotal_O0 += row.amount * row.cnt;
        if (p === 2) redeemTotal_O1 += row.amount * row.cnt;
      }
    }
  }

  console.log(`   Split total (tokens per outcome): ${splitTotal.toLocaleString()}`);
  console.log(`   Redemption O0: ${redeemTotal_O0.toLocaleString()}`);
  console.log(`   Redemption O1: ${redeemTotal_O1.toLocaleString()}`);

  // Calculate PnL per outcome
  const costBasis = 0.50;
  const o0_resolution = resolution[0];
  const o1_resolution = resolution[1];

  console.log(`\n   Resolution prices: O0=${o0_resolution}, O1=${o1_resolution}`);

  // Outcome 0: bought splitTotal @ $0.50, sold redeemTotal_O0 @ resolution
  const o0_position = splitTotal;
  const o0_sold = redeemTotal_O0;
  const o0_realized_pnl = o0_sold * (o0_resolution - costBasis);
  const o0_remaining = o0_position - o0_sold;
  const o0_unrealized_pnl = o0_remaining * (o0_resolution - costBasis);

  console.log(`\n   Outcome 0:`);
  console.log(`     Position: ${o0_position.toLocaleString()} tokens @ $${costBasis}`);
  console.log(`     Sold: ${o0_sold.toLocaleString()} tokens @ $${o0_resolution}`);
  console.log(`     Realized PnL: $${o0_realized_pnl.toLocaleString()}`);
  console.log(`     Remaining: ${o0_remaining.toLocaleString()} tokens`);
  console.log(`     Unrealized PnL: $${o0_unrealized_pnl.toLocaleString()}`);

  // Outcome 1: bought splitTotal @ $0.50, sold redeemTotal_O1 @ resolution
  const o1_position = splitTotal;
  const o1_sold = redeemTotal_O1;
  const o1_realized_pnl = o1_sold * (o1_resolution - costBasis);
  const o1_remaining = o1_position - o1_sold;
  const o1_unrealized_pnl = o1_remaining * (o1_resolution - costBasis);

  console.log(`\n   Outcome 1:`);
  console.log(`     Position: ${o1_position.toLocaleString()} tokens @ $${costBasis}`);
  console.log(`     Sold: ${o1_sold.toLocaleString()} tokens @ $${o1_resolution}`);
  console.log(`     Realized PnL: $${o1_realized_pnl.toLocaleString()}`);
  console.log(`     Remaining: ${o1_remaining.toLocaleString()} tokens`);
  console.log(`     Unrealized PnL: $${o1_unrealized_pnl.toLocaleString()}`);

  console.log('\n' + '═'.repeat(80));
  console.log(`TOTAL REALIZED PnL: $${(o0_realized_pnl + o1_realized_pnl).toLocaleString()}`);
  console.log(`TOTAL UNREALIZED PnL: $${(o0_unrealized_pnl + o1_unrealized_pnl).toLocaleString()}`);
  console.log(`TOTAL PnL: $${(o0_realized_pnl + o1_realized_pnl + o0_unrealized_pnl + o1_unrealized_pnl).toLocaleString()}`);
  console.log('═'.repeat(80));
}

main().catch(console.error);
