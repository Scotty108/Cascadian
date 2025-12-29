import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Creating Deduped View ===\n');

  // Drop existing view if exists
  try {
    await clickhouse.command({
      query: 'DROP VIEW IF EXISTS pm_unified_ledger_v9_clob_dedup_v1'
    });
    console.log('Dropped existing view (if any)');
  } catch (e) {
    console.log('No existing view to drop');
  }

  // Create the dedup view
  const createViewSQL = `
    CREATE VIEW pm_unified_ledger_v9_clob_dedup_v1 AS
    SELECT
      wallet_address,
      source_type,
      condition_id,
      outcome_index,
      event_id,
      event_time,
      trade_date,
      any(usdc_delta) AS usdc_delta,
      any(token_delta) AS token_delta,
      any(payout_norm) AS payout_norm,
      any(payout_numerators) AS payout_numerators,
      any(side) AS side,
      any(role) AS role
    FROM pm_unified_ledger_v9_clob_tbl
    WHERE source_type = 'CLOB'
      AND condition_id IS NOT NULL
      AND condition_id != ''
    GROUP BY
      wallet_address, source_type, condition_id, outcome_index, event_id, event_time, trade_date
  `;

  try {
    await clickhouse.command({ query: createViewSQL });
    console.log('Created pm_unified_ledger_v9_clob_dedup_v1 view');
  } catch (e: any) {
    console.log('Error creating view:', e.message);
  }

  // Test the view
  console.log('\n=== Testing View ===');
  const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';
  
  const testQuery = await clickhouse.query({
    query: `SELECT count() as rows FROM pm_unified_ledger_v9_clob_dedup_v1 
            WHERE lower(wallet_address) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const test = (await testQuery.json() as any[])[0];
  console.log('@ForgetAboutBenjamin rows in dedup view: ' + test.rows);
  console.log('(Was 2630 before, should be ~2208 now)');

  // Calculate PnL using the dedup view
  console.log('\n=== PnL from Dedup View ===');
  const pnlQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT 
                condition_id,
                outcome_index,
                sum(usdc_delta) as cash_flow,
                sum(token_delta) as final_tokens,
                any(payout_norm) as resolution
              FROM pm_unified_ledger_v9_clob_dedup_v1
              WHERE lower(wallet_address) = lower('${wallet}')
              GROUP BY condition_id, outcome_index
            )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, cash_flow + final_tokens * 0.5)) as total_pnl
            FROM positions`,
    format: 'JSONEachRow'
  });
  const pnl = (await pnlQuery.json() as any[])[0];
  console.log('PnL from dedup view: $' + Math.round(pnl.total_pnl).toLocaleString());
  console.log('UI Target: $10,268');
  console.log('Delta: ' + (Math.round(pnl.total_pnl) - 10268 > 0 ? '+' : '') + (Math.round(pnl.total_pnl) - 10268).toLocaleString());
}

main().catch(console.error);
