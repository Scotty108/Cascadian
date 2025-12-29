/**
 * Investigate Theo's two massive losing positions that aren't in the API
 */

import { clickhouse } from '../../lib/clickhouse/client';

const THEO_WALLET = '0x9d36c904930a7d06c5403f9e16996e919f586486';

// These two positions show massive losses in V12 but don't exist in API
const PROBLEM_CONDITIONS = [
  { id: '5ce0d897bd66142c43a3', full: '5ce0d897bd66142c43a3', v12_pnl: -15219.08 },
  { id: 'd009ac14bccdd12925a2', full: 'd009ac14bccdd12925a2', v12_pnl: -7732.46 },
];

async function main() {
  console.log('='.repeat(80));
  console.log("INVESTIGATING THEO'S MASSIVE LOSSES");
  console.log('='.repeat(80));

  for (const cond of PROBLEM_CONDITIONS) {
    console.log('\n' + '-'.repeat(80));
    console.log(`Condition: ${cond.id}...`);
    console.log(`V12 PnL: $${cond.v12_pnl.toFixed(2)}`);

    // Find full condition_id
    const fullIdResult = await clickhouse.query({
      query: `
        SELECT DISTINCT condition_id
        FROM pm_token_to_condition_map_v3
        WHERE condition_id LIKE '${cond.id}%'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const fullIds = (await fullIdResult.json()) as any[];
    const fullConditionId = fullIds[0]?.condition_id || cond.id;
    console.log(`Full condition_id: ${fullConditionId}`);

    // Check if market is resolved
    const resolutionResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          resolved_at,
          payout_numerators
        FROM pm_condition_resolutions
        WHERE condition_id = '${fullConditionId}'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const resolutions = (await resolutionResult.json()) as any[];
    if (resolutions.length > 0) {
      console.log('Resolution:');
      console.log(`  Resolved at: ${resolutions[0].resolved_at}`);
      console.log(`  Payout: ${resolutions[0].payout_numerators}`);
    } else {
      console.log('Resolution: NOT RESOLVED');
    }

    // Check trades
    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          event_id,
          side,
          usdc_amount / 1000000.0 as usdc,
          token_amount / 1000000.0 as tokens,
          trade_time
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${THEO_WALLET}')
          AND m.condition_id = '${fullConditionId}'
          AND t.is_deleted = 0
        ORDER BY t.trade_time
      `,
      format: 'JSONEachRow',
    });
    const trades = (await tradesResult.json()) as any[];
    console.log(`\nTrades: ${trades.length}`);

    let netTokens = 0;
    let totalCost = 0;
    let totalProceeds = 0;

    for (const t of trades) {
      const side = t.side === 0 ? 'BUY' : 'SELL';
      const price = Number(t.tokens) > 0 ? Number(t.usdc) / Number(t.tokens) : 0;
      console.log(
        `  ${side} ${Number(t.tokens).toFixed(2)} @ $${price.toFixed(4)} = $${Number(t.usdc).toFixed(2)}`
      );

      if (t.side === 0) {
        netTokens += Number(t.tokens);
        totalCost += Number(t.usdc);
      } else {
        netTokens -= Number(t.tokens);
        totalProceeds += Number(t.usdc);
      }
    }

    console.log('\nPosition Summary:');
    console.log(`  Net tokens: ${netTokens.toFixed(2)}`);
    console.log(`  Total cost: $${totalCost.toFixed(2)}`);
    console.log(`  Total proceeds: $${totalProceeds.toFixed(2)}`);
    const tradingPnl = totalProceeds - totalCost;
    console.log(`  Trading PnL: $${tradingPnl.toFixed(2)}`);

    // Check if this is in API positions
    const apiResult = await clickhouse.query({
      query: `
        SELECT *
        FROM pm_api_positions
        WHERE lower(wallet) = lower('${THEO_WALLET}')
          AND (condition_id = '${fullConditionId}' OR condition_id = '0x${fullConditionId}')
      `,
      format: 'JSONEachRow',
    });
    const apiPositions = (await apiResult.json()) as any[];
    if (apiPositions.length > 0) {
      console.log('\nAPI Position:', apiPositions);
    } else {
      console.log('\nAPI Position: NOT FOUND');
    }

    // Check if this is a NegRisk market
    const negriskResult = await clickhouse.query({
      query: `
        SELECT *
        FROM vw_negrisk_conversions
        WHERE lower(wallet) = lower('${THEO_WALLET}')
          AND condition_id = '${fullConditionId}'
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const negriskConversions = (await negriskResult.json()) as any[];
    if (negriskConversions.length > 0) {
      console.log('\nNegRisk Conversions:', negriskConversions.length);
    } else {
      console.log('\nNegRisk Conversions: NONE');
    }
  }
}

main().catch(console.error);
