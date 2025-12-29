import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Testing Dedup + External Inventory Clamp ===\n');

  // Dedup + clamp: only count sells up to the amount bought
  const clampedQuery = await clickhouse.query({
    query: `WITH 
              deduped AS (
                SELECT 
                  event_id,
                  any(condition_id) as condition_id,
                  any(outcome_index) as outcome_index,
                  any(usdc_delta) as usdc_delta,
                  any(token_delta) as token_delta,
                  any(payout_norm) as payout_norm
                FROM pm_unified_ledger_v9_clob_tbl
                WHERE lower(wallet_address) = lower('${wallet}')
                  AND source_type = 'CLOB'
                GROUP BY event_id
              ),
              raw_positions AS (
                SELECT 
                  condition_id,
                  outcome_index,
                  sum(usdc_delta) as cash_flow,
                  sum(token_delta) as net_tokens,
                  sumIf(token_delta, token_delta > 0) as total_bought,
                  sumIf(abs(token_delta), token_delta < 0) as total_sold,
                  any(payout_norm) as resolution
                FROM deduped
                WHERE condition_id IS NOT NULL AND condition_id != ''
                GROUP BY condition_id, outcome_index
              ),
              -- Clamp: if sold more than bought, cap final_tokens at bought - sold (clamped at 0)
              clamped_positions AS (
                SELECT
                  condition_id,
                  outcome_index,
                  -- Clamp cash flow: if external inventory sold, reduce cash inflow proportionally
                  if(total_sold > total_bought,
                     cash_flow * (total_bought / total_sold),
                     cash_flow) as adj_cash_flow,
                  -- Clamp final tokens: if sold more than bought, cap sells at bought amount
                  if(total_sold > total_bought,
                     total_bought - total_bought,  -- Net is 0 (sold all we bought)
                     net_tokens) as adj_tokens,
                  resolution,
                  total_bought,
                  total_sold
                FROM raw_positions
              )
            SELECT 
              sum(if(resolution IS NOT NULL, adj_cash_flow + adj_tokens * resolution, adj_cash_flow + adj_tokens * 0.5)) as clamped_pnl,
              count() as positions
            FROM clamped_positions`,
    format: 'JSONEachRow'
  });
  const clamped = (await clampedQuery.json() as any[])[0];
  console.log('Dedup + Clamped PnL: $' + Math.round(clamped.clamped_pnl).toLocaleString());

  // Alternative: just exclude positions where sold > bought
  const excludeQuery = await clickhouse.query({
    query: `WITH 
              deduped AS (
                SELECT 
                  event_id,
                  any(condition_id) as condition_id,
                  any(outcome_index) as outcome_index,
                  any(usdc_delta) as usdc_delta,
                  any(token_delta) as token_delta,
                  any(payout_norm) as payout_norm
                FROM pm_unified_ledger_v9_clob_tbl
                WHERE lower(wallet_address) = lower('${wallet}')
                  AND source_type = 'CLOB'
                GROUP BY event_id
              ),
              positions AS (
                SELECT 
                  condition_id,
                  outcome_index,
                  sum(usdc_delta) as cash_flow,
                  sum(token_delta) as final_tokens,
                  sumIf(token_delta, token_delta > 0) as total_bought,
                  sumIf(abs(token_delta), token_delta < 0) as total_sold,
                  any(payout_norm) as resolution
                FROM deduped
                WHERE condition_id IS NOT NULL AND condition_id != ''
                GROUP BY condition_id, outcome_index
              )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, cash_flow + final_tokens * 0.5)) as clean_pnl,
              count() as positions
            FROM positions
            WHERE total_sold <= total_bought * 1.05  -- Only include positions where sells <= buys (5% tolerance)`,
    format: 'JSONEachRow'
  });
  const excluded = (await excludeQuery.json() as any[])[0];
  console.log('Dedup + Exclude External: $' + Math.round(excluded.clean_pnl).toLocaleString());

  // Final comparison
  console.log('\n=== Final Comparison ===');
  console.log('UI Target:                  $10,268');
  console.log('V20 Raw (duped):            $31,257');
  console.log('V20 Deduped only:           $16,376');
  console.log('Dedup + Clamped:            $' + Math.round(clamped.clamped_pnl).toLocaleString());
  console.log('Dedup + Exclude External:   $' + Math.round(excluded.clean_pnl).toLocaleString());
}

main().catch(console.error);
