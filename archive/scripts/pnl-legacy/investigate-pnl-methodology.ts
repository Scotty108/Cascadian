/**
 * Investigate Polymarket PnL Methodology
 *
 * Hypothesis: Polymarket PnL = ONLY realized gains from actual SELL transactions
 * Not: Cash + (Final Position × Resolution Price)
 *
 * For W3, they show $5.44 but we calculate $2,541
 * Let's check what their actual sells look like.
 *
 * Terminal: Claude 1
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

const W3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function main() {
  console.log('=== INVESTIGATING POLYMARKET PNL METHODOLOGY ===');
  console.log('W3: UI shows $5.44, we calculate $2,541');
  console.log('');

  // HYPOTHESIS 1: PnL = Only SELL transactions (realized through trading)
  console.log('=== HYPOTHESIS 1: PnL = Sum of all SELL proceeds - Buy costs ===');

  const tradePnL = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount)/1e6 as usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${W3}' AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash_flow,
        SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as total_bought,
        SUM(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as total_sold
      FROM deduped
    `,
    format: 'JSONEachRow'
  });
  console.log('Trade-only PnL (no resolution value):', (await tradePnL.json())[0]);

  // HYPOTHESIS 2: PnL might include PayoutRedemption events from CTF
  console.log('');
  console.log('=== HYPOTHESIS 2: Check CTF Redemption Events ===');

  const ctfEvents = await client.query({
    query: `
      SELECT
        event_type,
        COUNT(*) as count,
        SUM(toFloat64OrNull(amount))/1e6 as total_amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${W3}'
      GROUP BY event_type
    `,
    format: 'JSONEachRow'
  });
  const ctf = await ctfEvents.json() as any[];
  console.log('CTF events:', ctf.length > 0 ? ctf : 'None found');

  // Check if there's a redemption matching the $2,500 gap
  console.log('');
  console.log('=== HYPOTHESIS 3: Check if large position was redeemed ===');

  const bigPosition = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount)/1e6 as usdc,
          any(token_amount)/1e6 as tokens,
          any(t.token_id) as token_id
        FROM pm_trader_events_v2 t
        WHERE trader_wallet = '${W3}' AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT
          d.*,
          m.condition_id,
          m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      )
      SELECT
        condition_id,
        outcome_index,
        SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_delta,
        SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_position
      FROM with_condition
      GROUP BY condition_id, outcome_index
      HAVING final_position > 1000  -- Large positions
      ORDER BY ABS(final_position) DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log('Large final positions (>1000 tokens):');
  console.log(await bigPosition.json());

  // HYPOTHESIS 4: The resolution price might be different
  console.log('');
  console.log('=== CHECKING THE BIG MARKET ===');
  console.log('condition: dd22472e552920b8...');

  const bigMarket = await client.query({
    query: `
      SELECT
        condition_id,
        payout_numerators,
        resolved_at
      FROM pm_condition_resolutions
      WHERE condition_id LIKE 'dd22472e552920b8%'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  console.log('Resolution:', await bigMarket.json());

  // Final: What if Polymarket excludes positions that weren't explicitly SOLD?
  console.log('');
  console.log('=== ALTERNATIVE CALCULATION ===');
  console.log('What if PnL = only positions where user made SELL transactions?');

  const sellOnly = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount)/1e6 as usdc,
          any(token_amount)/1e6 as tokens,
          any(t.token_id) as token_id
        FROM pm_trader_events_v2 t
        WHERE trader_wallet = '${W3}' AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT
          d.*,
          m.condition_id,
          m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      position_activity AS (
        SELECT
          condition_id,
          outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_delta,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_position,
          SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) as sell_count
        FROM with_condition
        GROUP BY condition_id, outcome_index
      )
      -- Only include positions where there was at least one SELL
      SELECT
        SUM(cash_delta) as total_cash_from_traded,
        SUM(CASE WHEN sell_count > 0 THEN final_position ELSE 0 END) as remaining_sold_positions,
        COUNT(*) as positions_with_activity,
        SUM(CASE WHEN sell_count > 0 THEN 1 ELSE 0 END) as positions_with_sells
      FROM position_activity
    `,
    format: 'JSONEachRow'
  });
  console.log('Positions with sells only:', await sellOnly.json());

  await client.close();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
