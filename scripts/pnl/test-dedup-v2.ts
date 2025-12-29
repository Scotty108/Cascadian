import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Testing Dedup Table with Fixed Resolution Join ===\n');

  // Check pm_condition_resolutions schema
  const resSchema = await clickhouse.query({
    query: 'DESCRIBE pm_condition_resolutions',
    format: 'JSONEachRow'
  });
  const resCols = await resSchema.json() as any[];
  console.log('pm_condition_resolutions columns:');
  resCols.slice(0,5).forEach((c: any) => console.log('   ' + c.name + ': ' + c.type));

  // Sample payout_numerators to see format
  const sampleRes = await clickhouse.query({
    query: 'SELECT condition_id, payout_numerators FROM pm_condition_resolutions LIMIT 3',
    format: 'JSONEachRow'
  });
  const samples = await sampleRes.json() as any[];
  console.log('\nSample payout_numerators format:');
  samples.forEach((s: any) => console.log('   ' + s.condition_id.slice(0, 16) + '...: ' + s.payout_numerators));

  // Try using v9_clob but with proper deduplication by event_id
  console.log('\n=== PnL with Manual Dedupe on v9_clob ===');
  const dedupPnlQuery = await clickhouse.query({
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
                  any(payout_norm) as resolution
                FROM deduped
                WHERE condition_id IS NOT NULL AND condition_id != ''
                GROUP BY condition_id, outcome_index
              )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, cash_flow + final_tokens * 0.5)) as total_pnl,
              count() as positions,
              countIf(resolution IS NOT NULL) as resolved
            FROM positions`,
    format: 'JSONEachRow'
  });
  const dedupPnl = (await dedupPnlQuery.json() as any[])[0];
  console.log('Deduped v9_clob PnL: $' + Math.round(dedupPnl.total_pnl).toLocaleString());
  console.log('Positions: ' + dedupPnl.positions + ' (' + dedupPnl.resolved + ' resolved)');

  // Compare to targets
  console.log('\n=== Final Comparison ===');
  console.log('UI Target:              $10,268');
  console.log('V20 Raw (duped):        $31,257');
  console.log('V20 Deduped:            $' + Math.round(dedupPnl.total_pnl).toLocaleString());
  console.log('Delta from UI:          ' + (Math.round(dedupPnl.total_pnl) - 10268 > 0 ? '+' : '') + 
              (Math.round(dedupPnl.total_pnl) - 10268).toLocaleString());
}

main().catch(console.error);
