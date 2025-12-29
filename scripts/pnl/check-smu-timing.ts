/**
 * Check SMU trades vs redemption timing
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const client = getClickHouseClient();
const wallet = '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd';
const smuTokenId = '17047276552061796208959991793280886673041704441023149309880525356447965581680';

async function main() {
  // Last trade on SMU
  const lastTrade = await client.query({
    query: `
      SELECT max(trade_time) as last_trade
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND token_id = '${smuTokenId}'
    `,
    format: 'JSONEachRow',
  });
  console.log('Last SMU CLOB trade:');
  console.log(await lastTrade.json());

  // All SMU trades
  const allTrades = await client.query({
    query: `
      SELECT
        side,
        sum(token_amount) / 1000000.0 as total_tokens,
        sum(usdc_amount) / 1000000.0 as total_usdc,
        count() as cnt
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(token_amount) as token_amount,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND token_id = '${smuTokenId}'
        GROUP BY event_id
      )
      GROUP BY side
    `,
    format: 'JSONEachRow',
  });
  console.log('\nSMU CLOB trades:');
  console.log(await allTrades.json());

  // Redemption time
  const redemption = await client.query({
    query: `
      SELECT
        event_type,
        condition_id,
        event_timestamp,
        toFloat64(amount_or_payout) / 1000000.0 as payout
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  console.log('\nRedemption event:');
  console.log(await redemption.json());

  console.log('\n=== ANALYSIS ===');
  console.log('SMU was REDEEMED. The redemption should be processed as a SELL at $1/token.');
  console.log('This would convert 464,576 tokens into $464,576 realized profit.');
  console.log('Currently showing as "open" position with unrealized gain of $278,982');
  console.log('Difference: $464,576 - $185,594 (cost) = $278,982 in unrealized');
  console.log('If processed as redemption: realized += $278,982, position = 0');
}

main().catch(console.error);
