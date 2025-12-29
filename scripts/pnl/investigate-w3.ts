/**
 * Investigate W3's large positions
 */
import { clickhouse } from '../../lib/clickhouse/client';

const W3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function main() {
  // Check W3's largest position - this is likely the Trump position
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
      SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as total_buy_cost,
      r.payout_numerators,
      r.resolved_at
    FROM (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1e6 as tokens,
        any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${W3}') AND is_deleted = 0
      GROUP BY event_id
    ) t
    INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    GROUP BY m.condition_id, m.outcome_index, r.payout_numerators, r.resolved_at
    HAVING net_tokens > 100
    ORDER BY net_tokens DESC
    LIMIT 10
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  console.log('W3 largest positions:');
  for (const r of rows) {
    const condId = r.condition_id || 'unknown';
    const payout_arr = r.payout_numerators ? JSON.parse(r.payout_numerators) : null;
    const payout_price = payout_arr ? payout_arr[r.outcome_index] : 'N/A';
    const is_resolved = r.resolved_at ? 'RESOLVED' : 'UNRESOLVED';
    const value_at_resolution = payout_arr ? Number(r.net_tokens) * payout_price : 0;
    const avg_cost = Number(r.total_buy_cost) / Number(r.net_tokens);
    const pnl = payout_arr ? (payout_price - avg_cost) * Number(r.net_tokens) : 0;
    console.log(`  condition_id: ${condId}`);
    console.log(`    outcome ${r.outcome_index}: net=${Number(r.net_tokens).toFixed(2)}, buy_cost=$${Number(r.total_buy_cost).toFixed(2)}, avg=$${avg_cost.toFixed(4)}`);
    console.log(`    ${is_resolved}, payout=$${payout_price}, value=$${value_at_resolution.toFixed(2)}, PnL=$${pnl.toFixed(2)}`);
    console.log('');
  }

  // Check redemptions for W3
  const redQuery = `
    SELECT condition_id, toFloat64OrZero(amount_or_payout)/1e6 as payout
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${W3}')
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const redResult = await clickhouse.query({ query: redQuery, format: 'JSONEachRow' });
  const redemptions = await redResult.json() as any[];

  console.log('W3 redemptions:');
  let totalRedeemed = 0;
  for (const r of redemptions) {
    const condId = r.condition_id || 'unknown';
    totalRedeemed += Number(r.payout);
    console.log(`  ${condId.substring(0,16)}... $${Number(r.payout).toFixed(2)}`);
  }
  console.log(`Total redeemed: $${totalRedeemed.toFixed(2)}`);
}
main().catch(console.error);
