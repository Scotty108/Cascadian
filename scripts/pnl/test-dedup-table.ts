import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Testing Deduped Tables ===\n');

  // 1. Check pm_trader_events_dedup_v2_tbl schema
  console.log('1. pm_trader_events_dedup_v2_tbl schema:');
  const schemaQuery = await clickhouse.query({
    query: 'DESCRIBE pm_trader_events_dedup_v2_tbl',
    format: 'JSONEachRow'
  });
  const schema = await schemaQuery.json() as any[];
  schema.forEach((c: any) => console.log('   ' + c.name + ': ' + c.type));

  // 2. Count rows for our wallet in both tables
  console.log('\n2. Row counts for @ForgetAboutBenjamin:');
  
  const v9Count = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_unified_ledger_v9_clob_tbl 
            WHERE lower(wallet_address) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const v9 = (await v9Count.json() as any[])[0];
  console.log('   pm_unified_ledger_v9_clob_tbl: ' + v9.cnt + ' rows');

  const dedupCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_dedup_v2_tbl 
            WHERE lower(trader_wallet) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const dedup = (await dedupCount.json() as any[])[0];
  console.log('   pm_trader_events_dedup_v2_tbl: ' + dedup.cnt + ' rows');

  // 3. Check for dupes in the dedup table
  console.log('\n3. Checking for dupes in dedup table:');
  const dupeCheck = await clickhouse.query({
    query: `SELECT count() as total, countDistinct(event_id) as unique_events
            FROM pm_trader_events_dedup_v2_tbl 
            WHERE lower(trader_wallet) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const dupes = (await dupeCheck.json() as any[])[0];
  console.log('   Total rows: ' + dupes.total);
  console.log('   Unique events: ' + dupes.unique_events);
  console.log('   Duplication: ' + (dupes.total / dupes.unique_events).toFixed(2) + 'x');

  // 4. Calculate PnL using dedup table
  console.log('\n4. PnL using pm_trader_events_dedup_v2_tbl:');
  const pnlQuery = await clickhouse.query({
    query: `WITH 
              trades AS (
                SELECT 
                  t.event_id,
                  m.condition_id,
                  m.outcome_index,
                  if(lower(t.side) = 'buy', -t.usdc_amount/1e6, t.usdc_amount/1e6) as usdc_delta,
                  if(lower(t.side) = 'buy', t.token_amount/1e6, -t.token_amount/1e6) as token_delta
                FROM pm_trader_events_dedup_v2_tbl t
                JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
                WHERE lower(t.trader_wallet) = lower('${wallet}')
              ),
              positions AS (
                SELECT 
                  condition_id,
                  outcome_index,
                  sum(usdc_delta) as cash_flow,
                  sum(token_delta) as final_tokens
                FROM trades
                GROUP BY condition_id, outcome_index
              ),
              with_resolution AS (
                SELECT 
                  p.condition_id,
                  p.outcome_index,
                  p.cash_flow,
                  p.final_tokens,
                  r.payout_numerators[p.outcome_index + 1] as resolution
                FROM positions p
                LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
              )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, cash_flow + final_tokens * 0.5)) as total_pnl,
              sumIf(cash_flow + final_tokens * resolution, resolution IS NOT NULL) as realized,
              sumIf(cash_flow + final_tokens * 0.5, resolution IS NULL) as unrealized,
              count() as positions
            FROM with_resolution`,
    format: 'JSONEachRow'
  });
  const pnl = (await pnlQuery.json() as any[])[0];
  console.log('   Total PnL: $' + Math.round(pnl.total_pnl).toLocaleString());
  console.log('   Realized: $' + Math.round(pnl.realized).toLocaleString());
  console.log('   Unrealized: $' + Math.round(pnl.unrealized).toLocaleString());
  console.log('   Positions: ' + pnl.positions);
  
  console.log('\n=== Comparison ===');
  console.log('UI Target:              $10,268');
  console.log('V20 (v9_clob duped):    $31,257');
  console.log('Dedup table:            $' + Math.round(pnl.total_pnl).toLocaleString());
  console.log('Delta from UI:          ' + (Math.round(pnl.total_pnl) - 10268 > 0 ? '+' : '') + 
              (Math.round(pnl.total_pnl) - 10268).toLocaleString());
}

main().catch(console.error);
