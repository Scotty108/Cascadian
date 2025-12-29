/**
 * Analyze W3's positions across all markets
 */

import { clickhouse } from '../../lib/clickhouse/client';

const W3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function main() {
  console.log('=== W3 ALL POSITIONS BY CONDITION ===');
  console.log('');

  // Get all positions grouped by token
  const posRes = await clickhouse.query({
    query: `
      WITH trades AS (
        SELECT
          token_id,
          sum(if(side = 'buy', tokens, 0)) as bought,
          sum(if(side = 'sell', tokens, 0)) as sold,
          sum(if(side = 'buy', usdc, 0)) as buy_usdc,
          sum(if(side = 'sell', usdc, 0)) as sell_usdc
        FROM (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(token_amount) / 1e6 as tokens,
            any(usdc_amount) / 1e6 as usdc
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String}
            AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      SELECT
        t.token_id,
        t.bought,
        t.sold,
        t.bought - t.sold as net_tokens,
        t.buy_usdc,
        t.sell_usdc,
        m.condition_id,
        m.outcome_index
      FROM trades t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE abs(t.bought - t.sold) > 0.1
      ORDER BY abs(t.bought - t.sold) DESC
      LIMIT 30
    `,
    query_params: { wallet: W3 },
    format: 'JSONEachRow',
  });
  const positions = (await posRes.json()) as any[];

  let totalWinnerValue = 0;
  let totalShortLiability = 0;

  for (const p of positions) {
    if (!p.condition_id) {
      console.log('NO MAPPING | token=' + p.token_id.substring(0, 16) + '... | net=' + p.net_tokens.toFixed(2));
      continue;
    }

    // Get resolution
    const resRes = await clickhouse.query({
      query: `
        SELECT payout_numerators
        FROM pm_condition_resolutions
        WHERE condition_id = {cid:String}
        LIMIT 1
      `,
      query_params: { cid: p.condition_id },
      format: 'JSONEachRow',
    });
    const res = ((await resRes.json()) as any[])[0];

    let status = 'UNRESOLVED';
    let payout: number | null = null;
    let value = 0;

    if (res) {
      const payouts = JSON.parse(res.payout_numerators);
      payout = payouts[p.outcome_index] >= 1000 ? 1 : payouts[p.outcome_index];

      if (p.net_tokens > 0) {
        // Long position
        if (payout === 1) {
          status = 'LONG WINNER';
          value = p.net_tokens;
          totalWinnerValue += value;
        } else {
          status = 'LONG LOSER';
          value = 0;
        }
      } else {
        // Short position
        if (payout === 1) {
          status = 'SHORT WINNER (LIABILITY)';
          value = -Math.abs(p.net_tokens);
          totalShortLiability += Math.abs(p.net_tokens);
        } else {
          status = 'SHORT LOSER (OK)';
          value = 0;
        }
      }
    }

    console.log(
      p.condition_id.substring(0, 12) + '... | idx=' + p.outcome_index + ' | ' + status.padEnd(22)
    );
    console.log(
      '  Net: ' +
        p.net_tokens.toFixed(2) +
        ' | Spent: $' +
        (p.buy_usdc - p.sell_usdc).toFixed(2) +
        ' | Value: $' +
        value.toFixed(2)
    );
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log('Total Winner Value: $' + totalWinnerValue.toFixed(2));
  console.log('Total Short Liability: $' + totalShortLiability.toFixed(2));
  console.log('Net MTM: $' + (totalWinnerValue - totalShortLiability).toFixed(2));

  // Get total cash
  const cashRes = await clickhouse.query({
    query: `
      SELECT
        sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as net_cash
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount) / 1e6 as usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String}
          AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    query_params: { wallet: W3 },
    format: 'JSONEachRow',
  });
  const cash = ((await cashRes.json()) as any[])[0];

  const redRes = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
      FROM pm_ctf_events
      WHERE user_address = {wallet:String}
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    query_params: { wallet: W3 },
    format: 'JSONEachRow',
  });
  const red = ((await redRes.json()) as any[])[0];

  console.log('Net Cash Flow: $' + cash.net_cash.toFixed(2));
  console.log('Redemptions: $' + red.total.toFixed(2));
  console.log('Realized Cash PnL: $' + (cash.net_cash + red.total).toFixed(2));
  console.log('');
  console.log('UI_PNL_EST = Realized + Winners - Liability');
  console.log(
    '         = ' +
      (cash.net_cash + red.total).toFixed(2) +
      ' + ' +
      totalWinnerValue.toFixed(2) +
      ' - ' +
      totalShortLiability.toFixed(2)
  );
  console.log(
    '         = $' + (cash.net_cash + red.total + totalWinnerValue - totalShortLiability).toFixed(2)
  );
  console.log('');
  console.log('UI shows: $5.44');
}

main().catch(console.error);
