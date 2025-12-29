/**
 * Detailed analysis of W3 wallet PnL discrepancy
 */

import { clickhouse } from '../../lib/clickhouse/client';

const W3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function main() {
  console.log('=== W3 DETAILED CASH FLOW ANALYSIS ===');
  console.log('');

  // Get CLOB trades breakdown
  const clobRes = await clickhouse.query({
    query: `
      SELECT
        side,
        count() as cnt,
        sum(usdc) as total_usdc,
        sum(tokens) as total_tokens
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc, any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY side
    `,
    query_params: { wallet: W3 },
    format: 'JSONEachRow',
  });
  const clob = (await clobRes.json()) as any[];

  console.log('CLOB TRADES:');
  let totalBuy = 0,
    totalSell = 0;
  for (const c of clob) {
    console.log(
      '  ' +
        c.side +
        ': ' +
        c.cnt +
        ' trades, $' +
        c.total_usdc.toFixed(2) +
        ' USDC, ' +
        c.total_tokens.toFixed(2) +
        ' tokens'
    );
    if (c.side === 'buy') totalBuy = c.total_usdc;
    if (c.side === 'sell') totalSell = c.total_usdc;
  }
  console.log('  Net: $' + (totalSell - totalBuy).toFixed(2));
  console.log('');

  // Get CTF events
  const ctfRes = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as cnt,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
      FROM pm_ctf_events
      WHERE user_address = {wallet:String} AND is_deleted = 0
      GROUP BY event_type
    `,
    query_params: { wallet: W3 },
    format: 'JSONEachRow',
  });
  const ctf = (await ctfRes.json()) as any[];

  console.log('CTF EVENTS:');
  let splits = 0,
    merges = 0,
    redemptions = 0;
  for (const c of ctf) {
    console.log('  ' + c.event_type + ': ' + c.cnt + ' events, $' + c.total.toFixed(2));
    if (c.event_type === 'PositionSplit') splits = c.total;
    if (c.event_type === 'PositionsMerge') merges = c.total;
    if (c.event_type === 'PayoutRedemption') redemptions = c.total;
  }
  console.log('');

  // Calculate
  const realizedCash = totalSell - totalBuy - splits + merges + redemptions;
  console.log('REALIZED CASH PnL:');
  console.log('  = (Sells - Buys) - Splits + Merges + Redemptions');
  console.log(
    '  = (' +
      totalSell.toFixed(2) +
      ' - ' +
      totalBuy.toFixed(2) +
      ') - ' +
      splits.toFixed(2) +
      ' + ' +
      merges.toFixed(2) +
      ' + ' +
      redemptions.toFixed(2)
  );
  console.log('  = $' + realizedCash.toFixed(2));
  console.log('');
  console.log('UI shows: $5.44');
  console.log('');

  // Get the biggest positions
  console.log('=== BIGGEST NET POSITIONS (TOP 5) ===');
  const posRes = await clickhouse.query({
    query: `
      SELECT
        token_id,
        sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens,
        sum(if(side = 'buy', usdc, 0)) as buy_usdc,
        sum(if(side = 'sell', usdc, 0)) as sell_usdc
      FROM (
        SELECT event_id, any(token_id) as token_id, any(side) as side, any(token_amount) / 1e6 as tokens, any(usdc_amount) / 1e6 as usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY token_id
      HAVING abs(net_tokens) > 10
      ORDER BY abs(net_tokens) DESC
      LIMIT 5
    `,
    query_params: { wallet: W3 },
    format: 'JSONEachRow',
  });
  const positions = (await posRes.json()) as any[];

  for (const p of positions) {
    // Get condition mapping
    const mapRes = await clickhouse.query({
      query: `SELECT condition_id, outcome_index FROM pm_token_to_condition_map_v3 WHERE token_id_dec = {tid:String} LIMIT 1`,
      query_params: { tid: p.token_id },
      format: 'JSONEachRow',
    });
    const map = ((await mapRes.json()) as any[])[0];

    if (map === undefined) {
      console.log('  token=' + p.token_id.substring(0, 16) + '... | NO MAPPING');
      continue;
    }

    // Get resolution
    const resRes = await clickhouse.query({
      query: `SELECT payout_numerators FROM pm_condition_resolutions WHERE condition_id = {cid:String} LIMIT 1`,
      query_params: { cid: map.condition_id },
      format: 'JSONEachRow',
    });
    const res = ((await resRes.json()) as any[])[0];

    let status = 'UNRESOLVED';
    if (res) {
      const payouts = JSON.parse(res.payout_numerators);
      const payout = payouts[map.outcome_index] >= 1000 ? 1 : payouts[map.outcome_index];
      if (p.net_tokens > 0) {
        status = payout === 1 ? 'LONG WINNER ($1 each)' : 'LONG LOSER ($0)';
      } else {
        status = payout === 1 ? 'SHORT WINNER (liability $1 each)' : 'SHORT LOSER ($0)';
      }
    }

    console.log('  cond=' + map.condition_id.substring(0, 12) + '... idx=' + map.outcome_index);
    console.log(
      '    net=' + p.net_tokens.toFixed(2) + ' | spent=$' + (p.buy_usdc - p.sell_usdc).toFixed(2) + ' | ' + status
    );
  }
}

main().catch(console.error);
