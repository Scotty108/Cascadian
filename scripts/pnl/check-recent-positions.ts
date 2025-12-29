/**
 * Check recent and unresolved positions for a wallet
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x16ea6d68c8305c1c8f95d247d0845d19c9cf6df7';

  // Find ANY unresolved positions OR recent trades
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      r.payout_numerators,
      sum(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1000000.0 as cash_flow,
      sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1000000.0 as final_shares,
      max(t.trade_time) as last_trade,
      count() as trades
    FROM pm_trader_events_dedup_v2_tbl t
    INNER JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    LEFT JOIN pm_condition_resolutions r
      ON lower(m.condition_id) = lower(r.condition_id)
      AND r.is_deleted = 0
    WHERE lower(t.trader_wallet) = lower('${wallet}')
    GROUP BY m.condition_id, m.outcome_index, r.payout_numerators
    ORDER BY last_trade DESC
    LIMIT 30
  `;

  console.log('Most recent 30 positions by last trade date:\n');
  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  let totalUnresolved = 0;
  let unresolvedCashFlow = 0;
  let unresolvedShares = 0;

  for (const row of rows) {
    const status = row.payout_numerators ? '✅' : '❌';
    const shares = Number(row.final_shares).toFixed(0);
    const cash = Number(row.cash_flow).toFixed(2);

    if (row.payout_numerators === null || row.payout_numerators === undefined) {
      totalUnresolved++;
      unresolvedCashFlow += Number(row.cash_flow);
      unresolvedShares += Number(row.final_shares);
    }

    const condId = row.condition_id || 'MISSING_CONDITION';
    console.log(`${status} ${row.last_trade} | ${condId.slice(0,16)}... out${row.outcome_index} | shares: ${shares.padStart(8)} | cash: $${cash.padStart(10)} | ${row.payout_numerators || 'UNRESOLVED'}`);
  }

  console.log('\n' + '─'.repeat(100));
  console.log('Unresolved in top 30:', totalUnresolved);
  console.log('Unresolved cash flow:', '$' + unresolvedCashFlow.toFixed(2));
  console.log('Unresolved shares:', unresolvedShares.toFixed(2));

  // If unresolved shares are positive and priced at ~0.5, potential unrealized = shares * 0.5
  if (unresolvedShares > 0) {
    console.log('Potential unrealized @ 50¢:', '$' + (unresolvedShares * 0.5).toFixed(2));
    console.log('Potential total if they win:', '$' + (unresolvedCashFlow + unresolvedShares).toFixed(2));
  }

  // Also check wallet's latest trade date
  const latestTrade = `
    SELECT max(trade_time) as latest
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;
  const ltResult = await client.query({ query: latestTrade, format: 'JSONEachRow' });
  const ltRow = (await ltResult.json())[0] as any;
  console.log('\nWallet latest trade:', ltRow.latest);
}

main().catch(console.error);
