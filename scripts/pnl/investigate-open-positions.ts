/**
 * Investigate why V12 shows negative PnL for positions where API shows $0
 *
 * Hypothesis: These are OPEN positions (not yet resolved) that V12 is
 * incorrectly calculating PnL for.
 */

import { clickhouse } from '../../lib/clickhouse/client';

// Wallet 6 from our test
const WALLET = '0xef9b7ff3f5ceedc4be6a0fa6fbb5f2c696899fef';

// The 4 mismatched conditions - API shows $0, V12 shows negative
const MISMATCHED_CONDITIONS = [
  '263ab21500b1cb94e098b5fe14bd0f08eb64dfea2ff7aa5b82a88a3d36e8d618', // Yes, API: $0, V12: -$30.40
  '5872c8e6115ceb967f6e67c5a1ba5b00fe0d9bbb55b2e7f6edea01b87afc2a85', // Down, API: $0, V12: -$1132.50
  '68e505b808eb64da6c1e89d9cffcb99af1efc1cf403e2e69d2dbb4ec29f5e2cd', // Up, API: $0, V12: -$1044.00
  'a3e38b466dd2d4f04ddc2a59f2d1a28aa3bc3dcb71efd8e57bdc78614ca0fe71', // Yes, API: $0, V12: -$1068.05
];

async function main() {
  console.log('='.repeat(80));
  console.log('INVESTIGATING OPEN POSITIONS');
  console.log('='.repeat(80));

  for (const conditionId of MISMATCHED_CONDITIONS) {
    console.log('\n' + '-'.repeat(80));
    console.log(`Condition: ${conditionId.substring(0, 20)}...`);

    // 1. Check if this market is resolved
    const resolutionResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          resolved_at,
          payout_numerators
        FROM pm_condition_resolutions
        WHERE condition_id = '${conditionId}'
          AND is_deleted = 0
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const resolutions = (await resolutionResult.json()) as any[];

    if (resolutions.length === 0) {
      console.log('  Status: NOT RESOLVED (no resolution record)');
    } else {
      console.log('  Status: RESOLVED');
      console.log(`    Resolved at: ${resolutions[0].resolved_at}`);
      console.log(`    Payout numerators: ${resolutions[0].payout_numerators}`);
    }

    // 2. Check this wallet's trades for this condition
    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          t.side,
          t.usdc_amount / 1000000.0 as usdc,
          t.token_amount / 1000000.0 as tokens,
          t.trade_time,
          m.outcome_index
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${WALLET}')
          AND m.condition_id = '${conditionId}'
          AND t.is_deleted = 0
        ORDER BY t.trade_time
      `,
      format: 'JSONEachRow',
    });
    const trades = (await tradesResult.json()) as any[];

    console.log(`  Trades: ${trades.length}`);
    let netPosition = 0;
    let totalCost = 0;
    let totalProceeds = 0;

    for (const t of trades) {
      const side = t.side === 0 ? 'BUY' : 'SELL';
      const price = Number(t.tokens) > 0 ? Number(t.usdc) / Number(t.tokens) : 0;
      console.log(`    ${side}: ${Number(t.tokens).toFixed(2)} tokens @ ${price.toFixed(4)} USDC (${t.trade_time})`);

      if (t.side === 0) {
        netPosition += Number(t.tokens);
        totalCost += Number(t.usdc);
      } else {
        netPosition -= Number(t.tokens);
        totalProceeds += Number(t.usdc);
      }
    }

    console.log(`  Net Position: ${netPosition.toFixed(2)} tokens`);
    console.log(`  Total Cost: $${totalCost.toFixed(2)}`);
    console.log(`  Total Proceeds: $${totalProceeds.toFixed(2)}`);

    // 3. Check API position data
    const apiResult = await clickhouse.query({
      query: `
        SELECT
          realized_pnl,
          outcome,
          size,
          avg_price,
          initial_value,
          current_value,
          is_closed
        FROM pm_api_positions
        WHERE lower(wallet) = lower('${WALLET}')
          AND condition_id = '${conditionId}'
      `,
      format: 'JSONEachRow',
    });
    const apiPositions = (await apiResult.json()) as any[];

    if (apiPositions.length > 0) {
      console.log('  API Position:');
      for (const p of apiPositions) {
        console.log(`    Outcome: ${p.outcome}`);
        console.log(`    Size: ${Number(p.size).toFixed(2)}`);
        console.log(`    Avg Price: ${Number(p.avg_price).toFixed(4)}`);
        console.log(`    Initial Value: $${Number(p.initial_value).toFixed(2)}`);
        console.log(`    Current Value: $${Number(p.current_value).toFixed(2)}`);
        console.log(`    Realized PnL: $${Number(p.realized_pnl).toFixed(2)}`);
        console.log(`    Is Closed: ${p.is_closed}`);
      }
    } else {
      console.log('  API Position: NOT FOUND');
    }

    // 4. Diagnosis
    console.log('  DIAGNOSIS:');
    if (resolutions.length === 0 && netPosition > 0) {
      console.log('    -> OPEN POSITION: Market not resolved, position still held');
      console.log('    -> V12 should NOT calculate realized PnL for this');
    } else if (resolutions.length > 0) {
      console.log('    -> RESOLVED: Check if V12 resolution logic is correct');
    } else {
      console.log('    -> Position closed via trading (netPosition = 0)');
    }
  }
}

main().catch(console.error);
