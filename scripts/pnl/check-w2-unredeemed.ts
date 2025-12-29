/**
 * Check W2's unredeemed resolved conditions
 */
import { clickhouse } from '../../lib/clickhouse/client';

const W2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

async function main() {
  const query = `
    WITH traded_conditions AS (
      SELECT DISTINCT m.condition_id
      FROM (
        SELECT any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${W2}') AND is_deleted = 0
        GROUP BY event_id
      ) t
      INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    ),
    redeemed_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${W2}')
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    )
    SELECT
      tc.condition_id,
      r.resolved_at,
      r.payout_numerators,
      rc.condition_id IS NOT NULL as was_redeemed
    FROM traded_conditions tc
    LEFT JOIN pm_condition_resolutions r ON lower(tc.condition_id) = lower(r.condition_id)
    LEFT JOIN redeemed_conditions rc ON lower(tc.condition_id) = lower(rc.condition_id)
    ORDER BY was_redeemed, tc.condition_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  console.log('W2 traded conditions:');
  let notRedeemed = 0;
  let resolved = 0;
  let unresolved = 0;

  for (const r of rows) {
    const wasRedeemed = r.was_redeemed;
    const condId = r.condition_id || 'unknown';
    const status = wasRedeemed ? 'REDEEMED' : (r.resolved_at ? 'resolved NOT redeemed' : 'unresolved');
    if (!wasRedeemed && r.resolved_at) notRedeemed++;
    if (r.resolved_at) resolved++;
    else unresolved++;
    console.log(`  ${condId.substring(0,16)}... | ${status} | payouts: ${r.payout_numerators || 'N/A'}`);
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Total traded: ${rows.length}`);
  console.log(`  Resolved: ${resolved}`);
  console.log(`  Unresolved: ${unresolved}`);
  console.log(`  Resolved but NOT redeemed: ${notRedeemed}`);
}
main().catch(console.error);
