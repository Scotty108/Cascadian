/**
 * Check actual redemption payout to understand payout format
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const client = getClickHouseClient();
const wallet = '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd';

async function main() {
  // Get the SMU redemption
  const redemption = await client.query({
    query: `
      SELECT
        event_type,
        condition_id,
        toFloat64(amount_or_payout) / 1000000.0 as payout_usdc
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });

  console.log('Redemption events:');
  const rows = await redemption.json() as Array<{
    event_type: string;
    condition_id: string;
    payout_usdc: number;
  }>;

  for (const r of rows) {
    console.log(`\nCondition: ${r.condition_id.substring(0, 20)}...`);
    console.log(`Payout: $${r.payout_usdc.toLocaleString()}`);

    // Get the resolution
    const res = await client.query({
      query: `
        SELECT payout_numerators, payout_denominator
        FROM pm_condition_resolutions
        WHERE condition_id = '${r.condition_id}'
      `,
      format: 'JSONEachRow',
    });
    const resRows = await res.json() as Array<{payout_numerators: string; payout_denominator: string}>;
    if (resRows[0]) {
      console.log(`Resolution: ${resRows[0].payout_numerators} / ${resRows[0].payout_denominator}`);
    }

    // If we know the token count from trades
    console.log(`\nIf 464,576 tokens were redeemed:`);
    console.log(`  Payout per token = $${(r.payout_usdc / 464576).toFixed(4)}`);
    console.log(`  This suggests winners get $1 per token!`);
  }

  // Check: what was the position BEFORE redemption?
  console.log('\n=== SMU position from trades ===');
  const smuCondition = 'dda0a9cff834a4b16e1ef08392037eb2502045583394b4cf8145a4553ce3c595';

  // Get token_ids for this condition
  const tokenMap = await client.query({
    query: `
      SELECT token_id_dec, outcome_index, question
      FROM pm_token_to_condition_map_current
      WHERE condition_id = '${smuCondition}'
    `,
    format: 'JSONEachRow',
  });

  const tokenRows = await tokenMap.json() as Array<{token_id_dec: string; outcome_index: number; question: string}>;
  console.log('Tokens for SMU condition:');

  for (const t of tokenRows) {
    console.log(`\n  Outcome ${t.outcome_index}: ${t.token_id_dec.substring(0, 20)}...`);

    // Get trades for this token
    const trades = await client.query({
      query: `
        SELECT
          side,
          sum(tokens) as total_tokens,
          sum(usdc) as total_usdc
        FROM (
          SELECT
            event_id,
            any(side) as side,
            any(token_amount) / 1000000.0 as tokens,
            any(usdc_amount) / 1000000.0 as usdc
          FROM pm_trader_events_dedup_v2_tbl
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND token_id = '${t.token_id_dec}'
          GROUP BY event_id
        )
        GROUP BY side
      `,
      format: 'JSONEachRow',
    });

    const tradeRows = await trades.json() as Array<{side: string; total_tokens: number; total_usdc: number}>;
    for (const tr of tradeRows) {
      console.log(`    ${tr.side}: ${tr.total_tokens.toLocaleString()} tokens for $${tr.total_usdc.toLocaleString()}`);
    }
  }
}

main().catch(console.error);
