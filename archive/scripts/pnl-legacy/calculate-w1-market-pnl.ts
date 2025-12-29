/**
 * Calculate W1 Market-Level PnL
 *
 * For accurate PnL, aggregate at MARKET level (condition_id)
 * and apply resolutions to net positions per outcome
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 180000
});

const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';

async function main() {
  console.log('=== MARKET-LEVEL PNL CALCULATION FOR W1 ===');
  console.log('');

  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount)/1e6 as usdc,
          any(token_amount)/1e6 as tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${W1}' AND is_deleted = 0
        GROUP BY event_id
      ),
      with_mapping AS (
        SELECT d.*, m.condition_id, m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m
          ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      by_outcome AS (
        SELECT
          condition_id,
          outcome_index,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_shares,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash
        FROM with_mapping
        GROUP BY condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT
          b.*,
          r.payout_numerators,
          r.resolved_at
        FROM by_outcome b
        LEFT JOIN pm_condition_resolutions r
          ON lower(b.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
      )
      SELECT * FROM with_resolution
      ORDER BY condition_id, outcome_index
    `,
    format: 'JSONEachRow'
  });

  const positions = await result.json() as any[];

  // Group by condition_id
  const byCondition: { [key: string]: any[] } = {};
  for (const p of positions) {
    const cid = p.condition_id;
    if (!byCondition[cid]) {
      byCondition[cid] = [];
    }
    byCondition[cid].push(p);
  }

  let totalPnl = 0;
  let resolvedMarkets = 0;
  let unresolvedMarkets = 0;

  console.log('Market-by-market breakdown (showing markets with |PnL| > $1000):');
  console.log('');

  for (const conditionId of Object.keys(byCondition)) {
    const outcomes = byCondition[conditionId];

    // Calculate market PnL
    let marketCash = 0;
    let marketShareValue = 0;
    let isResolved = false;
    let payouts: number[] = [];

    for (const o of outcomes) {
      marketCash += o.net_cash || 0;

      if (o.payout_numerators) {
        isResolved = true;
        payouts = JSON.parse(o.payout_numerators);
        const payout = payouts[o.outcome_index] || 0;
        marketShareValue += (o.net_shares || 0) * payout;
      }
    }

    const marketPnl = marketCash + marketShareValue;

    if (isResolved) {
      resolvedMarkets++;
      totalPnl += marketPnl;
    } else {
      unresolvedMarkets++;
    }

    // Print significant markets
    if (Math.abs(marketPnl) > 1000) {
      console.log('Market: ' + conditionId.substring(0, 16) + '...');
      console.log('  Status: ' + (isResolved ? 'RESOLVED' : 'UNRESOLVED'));
      for (const o of outcomes) {
        const payout = payouts[o.outcome_index] || 0;
        console.log('  Outcome ' + o.outcome_index + ': shares=' + (o.net_shares || 0).toFixed(2) + ', cash=$' + (o.net_cash || 0).toFixed(2) + ', payout=' + payout);
      }
      console.log('  Market PnL: $' + marketPnl.toFixed(2));
      console.log('');
    }
  }

  console.log('=== SUMMARY ===');
  console.log('Resolved markets: ' + resolvedMarkets);
  console.log('Unresolved markets: ' + unresolvedMarkets);
  console.log('');
  console.log('Total Realized PnL (CLOB only): $' + totalPnl.toFixed(2));
  console.log('Expected (API): $12,298.89');
  console.log('Difference: $' + (totalPnl - 12298.89).toFixed(2));

  // Also check PayoutRedemption events
  console.log('');
  console.log('=== PAYOUT REDEMPTION CASH ===');
  const payoutsResult = await client.query({
    query: `
      SELECT
        SUM(toFloat64(amount_or_payout))/1e6 as total_payout
      FROM pm_ctf_events
      WHERE lower(user_address) = '${W1}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const payoutTotal = (await payoutsResult.json() as any[])[0];
  console.log('PayoutRedemption total: $' + (payoutTotal.total_payout || 0).toFixed(2));
  console.log('');
  console.log('NOTE: PayoutRedemption is cash received when redeeming winning tokens.');
  console.log('This should NOT be added on top - it\'s already accounted for in the share value calculation.');

  await client.close();
}

main().catch(console.error);
