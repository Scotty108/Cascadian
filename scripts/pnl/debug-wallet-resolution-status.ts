/**
 * Debug wallet resolution status breakdown
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x7f3c8979d0afa00007bae4747d5347122af05613';

  // Comprehensive breakdown
  const result = await client.query({
    query: `
      SELECT
        t.token_id,
        SUM(if(t.side='buy', t.token_amount, 0))/1e6 as maker_buy,
        SUM(if(t.side='sell', t.token_amount, 0))/1e6 as maker_sell,
        SUM(t.usdc_amount)/1e6 as total_usdc,
        any(m.condition_id) as condition_id,
        any(r.payout_numerators) as payout_numerators,
        any(m.outcome_index) as outcome_index
      FROM (
        SELECT event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) as token_amount,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
          AND role = 'maker'
        GROUP BY event_id
      ) t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      GROUP BY t.token_id
      ORDER BY (maker_buy - maker_sell) DESC
      LIMIT 15
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  console.log('Top 15 maker positions by size:');
  let winValue = 0;
  let lossValue = 0;
  let unresolvedValue = 0;

  for (const r of rows) {
    const net = Number(r.maker_buy) - Number(r.maker_sell);
    const payoutNums = r.payout_numerators;
    const outcomeIdx = r.outcome_index;

    let status = 'UNRESOLVED';
    if (payoutNums && payoutNums.length > 2) {
      try {
        const payouts = JSON.parse(payoutNums);
        const payout = payouts[outcomeIdx];
        status = payout >= 1 ? 'WIN' : 'LOSS';
      } catch {
        status = 'PARSE_ERROR';
      }
    }

    console.log(
      `${r.token_id.toString().slice(0, 15)}... ${net.toFixed(0).padStart(8)} tokens | ${status.padEnd(10)} | payout: ${payoutNums || 'null'}`
    );

    if (status === 'WIN') winValue += net;
    else if (status === 'LOSS') lossValue += net;
    else unresolvedValue += net;
  }

  console.log('\nSummary (tokens):');
  console.log('  WIN:', winValue.toFixed(0));
  console.log('  LOSS:', lossValue.toFixed(0));
  console.log('  UNRESOLVED:', unresolvedValue.toFixed(0));

  // Now compute what the unrealized SHOULD be for WIN positions
  console.log('\n=== Computing correct unrealized PnL ===');
  console.log('For WIN positions: unrealized = amount * (1 - avgPrice)');
  console.log('For LOSS positions: unrealized = amount * (0 - avgPrice)');
  console.log('For UNRESOLVED: unrealized = 0 (market still open)');
}

main().catch(console.error);
