/**
 * Check what pm_unified_ledger_v6 has for f918
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';

async function main() {
  console.log('Checking pm_unified_ledger_v6 for f918\n');

  const query = `
    SELECT
      condition_id,
      outcome_index,
      sum(usdc_delta) AS cash_flow,
      sum(token_delta) AS final_tokens,
      count() AS trade_count
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'CLOB'
      AND condition_id IS NOT NULL
      AND condition_id != ''
    GROUP BY condition_id, outcome_index
    ORDER BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('Condition (last 12) | Outcome | Cash Flow | Final Tokens | Trades');
  console.log('-'.repeat(70));

  let totalCashFlow = 0;
  let totalTokens = 0;

  for (const row of rows) {
    console.log(
      `...${row.condition_id.slice(-12)} | ${row.outcome_index.toString().padStart(7)} | ${row.cash_flow.toFixed(2).padStart(9)} | ${row.final_tokens.toFixed(2).padStart(12)} | ${row.trade_count.toString().padStart(6)}`
    );
    totalCashFlow += row.cash_flow;
    totalTokens += row.final_tokens;
  }

  console.log('-'.repeat(70));
  console.log(`Total | ${totalCashFlow.toFixed(2).padStart(18)} | ${totalTokens.toFixed(2).padStart(12)} |`);

  // Also check the raw trades from pm_trader_events_v2 for comparison
  console.log('\n\nComparing with pm_trader_events_v2 (after dedup):');

  const rawQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      sum(if(d.side = 'sell', d.usdc, -d.usdc)) AS cash_flow,
      sum(if(d.side = 'buy', d.tokens, -d.tokens)) AS final_tokens,
      count() AS trade_count
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    WHERE m.condition_id IS NOT NULL
    GROUP BY m.condition_id, m.outcome_index
    ORDER BY m.condition_id, m.outcome_index
  `;

  const rawResult = await clickhouse.query({ query: rawQuery, format: 'JSONEachRow' });
  const rawRows = (await rawResult.json()) as any[];

  console.log('Condition (last 12) | Outcome | Cash Flow | Final Tokens | Trades');
  console.log('-'.repeat(70));

  let totalRawCashFlow = 0;
  let totalRawTokens = 0;

  for (const row of rawRows) {
    console.log(
      `...${row.condition_id.slice(-12)} | ${row.outcome_index.toString().padStart(7)} | ${row.cash_flow.toFixed(2).padStart(9)} | ${row.final_tokens.toFixed(2).padStart(12)} | ${row.trade_count.toString().padStart(6)}`
    );
    totalRawCashFlow += row.cash_flow;
    totalRawTokens += row.final_tokens;
  }

  console.log('-'.repeat(70));
  console.log(`Total | ${totalRawCashFlow.toFixed(2).padStart(18)} | ${totalRawTokens.toFixed(2).padStart(12)} |`);

  // Summary
  console.log('\n\nSummary:');
  console.log(`pm_unified_ledger_v6: ${rows.length} positions, cash_flow=$${totalCashFlow.toFixed(2)}, tokens=${totalTokens.toFixed(2)}`);
  console.log(`pm_trader_events_v2: ${rawRows.length} positions, cash_flow=$${totalRawCashFlow.toFixed(2)}, tokens=${totalRawTokens.toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
