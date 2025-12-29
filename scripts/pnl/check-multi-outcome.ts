/**
 * Check multi-outcome positions for a wallet
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x16ea6d68c8305c1c8f95d247d0845d19c9cf6df7';

  // Find positions with outcome_index > 1 (multi-outcome markets)
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      r.payout_numerators,
      sum(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1000000.0 as cash_flow,
      sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1000000.0 as final_shares,
      max(t.trade_time) as last_trade
    FROM pm_trader_events_dedup_v2_tbl t
    INNER JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    LEFT JOIN pm_condition_resolutions r
      ON lower(m.condition_id) = lower(r.condition_id)
      AND r.is_deleted = 0
    WHERE lower(t.trader_wallet) = lower('${wallet}')
      AND m.outcome_index > 1
    GROUP BY m.condition_id, m.outcome_index, r.payout_numerators
    ORDER BY last_trade DESC
  `;

  console.log('MULTI-OUTCOME POSITIONS (outcome_index > 1):\n');
  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) {
    console.log('None found.');
    return;
  }

  let totalCash = 0;
  let totalShares = 0;

  for (const row of rows) {
    const status = row.payout_numerators ? '✅' : '❌';
    console.log(`${status} condition: ${row.condition_id}`);
    console.log(`   outcome: ${row.outcome_index}`);
    console.log(`   shares: ${Number(row.final_shares).toFixed(2)}`);
    console.log(`   cash: $${Number(row.cash_flow).toFixed(2)}`);
    console.log(`   payout: ${row.payout_numerators || 'UNRESOLVED'}`);
    console.log(`   last_trade: ${row.last_trade}`);
    console.log();

    const hasNoResolution = !row.payout_numerators;
    if (hasNoResolution) {
      totalCash += Number(row.cash_flow);
      totalShares += Number(row.final_shares);
    }
  }

  console.log('─'.repeat(60));
  console.log('Total multi-outcome positions:', rows.length);
  console.log('Unresolved cash:', '$' + totalCash.toFixed(2));
  console.log('Unresolved shares:', totalShares.toFixed(2));

  // Calculate potential PnL impact
  if (totalShares > 0) {
    console.log('\nIf unresolved positions win (shares*1):', '$' + (totalCash + totalShares).toFixed(2));
    console.log('If marked at 50¢:', '$' + (totalCash + totalShares * 0.5).toFixed(2));
  }
}

main().catch(console.error);
