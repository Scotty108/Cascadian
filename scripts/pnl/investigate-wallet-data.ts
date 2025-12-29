/**
 * Investigate wallet data sources
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x59c2a6bfcc65386bd0332f45822e45510482ad06';

  console.log('Investigating wallet:', wallet);
  console.log('\n' + '═'.repeat(80));

  // Check pm_unified_ledger_v6 for this wallet
  const query = `
    SELECT
      condition_id,
      outcome_index,
      source_type,
      payout_norm,
      count() as trades,
      sum(usdc_delta) as cash_flow,
      sum(token_delta) as final_tokens
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${wallet}')
    GROUP BY condition_id, outcome_index, source_type, payout_norm
    ORDER BY abs(final_tokens) DESC
    LIMIT 15
  `;

  console.log('\n1. Positions from pm_unified_ledger_v6:');
  console.log('─'.repeat(80));
  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) {
    console.log('No data found in pm_unified_ledger_v6!');
  }

  for (const r of rows) {
    const resolved = r.payout_norm !== null ? '[R]' : '[U]';
    const cid = (r.condition_id || 'NULL').slice(0, 20);
    console.log(`${resolved} cid: ${cid}... | out: ${r.outcome_index} | src: ${r.source_type} | payout: ${r.payout_norm ?? 'NULL'} | tokens: ${Number(r.final_tokens).toFixed(2)} | cash: ${Number(r.cash_flow).toFixed(2)}`);
  }

  // Also check the dedup table directly
  console.log('\n\n2. Positions from pm_trader_events_dedup_v2_tbl (fresh CLOB):');
  console.log('─'.repeat(80));

  const dedupQuery = `
    SELECT
      m.condition_id,
      m.outcome_index,
      r.payout_numerators,
      count() as trades,
      sum(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1000000.0 as cash_flow,
      sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1000000.0 as final_tokens
    FROM pm_trader_events_dedup_v2_tbl t
    INNER JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    LEFT JOIN pm_condition_resolutions r
      ON lower(m.condition_id) = lower(r.condition_id)
      AND r.is_deleted = 0
    WHERE lower(t.trader_wallet) = lower('${wallet}')
    GROUP BY m.condition_id, m.outcome_index, r.payout_numerators
    ORDER BY abs(final_tokens) DESC
    LIMIT 15
  `;

  const dedupResult = await client.query({ query: dedupQuery, format: 'JSONEachRow' });
  const dedupRows = await dedupResult.json() as any[];

  if (dedupRows.length === 0) {
    console.log('No data found in dedup table!');
  }

  for (const r of dedupRows) {
    const resolved = r.payout_numerators ? '[R]' : '[U]';
    const cid = (r.condition_id || 'NULL').slice(0, 20);
    console.log(`${resolved} cid: ${cid}... | out: ${r.outcome_index} | payout: ${r.payout_numerators || 'NULL'} | tokens: ${Number(r.final_tokens).toFixed(2)} | cash: ${Number(r.cash_flow).toFixed(2)}`);
  }

  // Check the freshness of pm_unified_ledger_v6
  console.log('\n\n3. Data freshness check:');
  console.log('─'.repeat(80));

  const freshnessQuery = `
    SELECT
      'pm_unified_ledger_v6' as source,
      max(event_time) as latest_event
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${wallet}')

    UNION ALL

    SELECT
      'pm_trader_events_dedup_v2_tbl' as source,
      max(trade_time) as latest_event
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;

  const freshnessResult = await client.query({ query: freshnessQuery, format: 'JSONEachRow' });
  const freshnessRows = await freshnessResult.json() as any[];

  for (const r of freshnessRows) {
    console.log(`${r.source}: ${r.latest_event || 'No data'}`);
  }
}

main().catch(console.error);
