import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Testing Different PnL Approaches ===');
  console.log('Wallet: @ForgetAboutBenjamin');
  console.log('UI Target: $10,267.82\n');

  // Approach 1: V20 current (all roles, no dedupe)
  const v20Query = await clickhouse.query({
    query: `WITH positions AS (
              SELECT condition_id, outcome_index,
                sum(usdc_delta) as cf, sum(token_delta) as tok, any(payout_norm) as res
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB' AND condition_id IS NOT NULL AND condition_id != ''
              GROUP BY condition_id, outcome_index
            )
            SELECT sum(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5)) as pnl FROM positions`,
    format: 'JSONEachRow'
  });
  const v20 = (await v20Query.json() as any[])[0];
  console.log('1. V20 Current (all roles):     $' + Math.round(v20.pnl).toLocaleString().padStart(10));

  // Approach 2: Maker only
  const makerQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT condition_id, outcome_index,
                sum(usdc_delta) as cf, sum(token_delta) as tok, any(payout_norm) as res
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB' AND condition_id IS NOT NULL AND condition_id != ''
                AND role = 'maker'
              GROUP BY condition_id, outcome_index
            )
            SELECT sum(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5)) as pnl FROM positions`,
    format: 'JSONEachRow'
  });
  const maker = (await makerQuery.json() as any[])[0];
  console.log('2. Maker-only:                  $' + Math.round(maker.pnl).toLocaleString().padStart(10));

  // Approach 3: Taker only
  const takerQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT condition_id, outcome_index,
                sum(usdc_delta) as cf, sum(token_delta) as tok, any(payout_norm) as res
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB' AND condition_id IS NOT NULL AND condition_id != ''
                AND role = 'taker'
              GROUP BY condition_id, outcome_index
            )
            SELECT sum(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5)) as pnl FROM positions`,
    format: 'JSONEachRow'
  });
  const taker = (await takerQuery.json() as any[])[0];
  console.log('3. Taker-only:                  $' + Math.round(taker.pnl).toLocaleString().padStart(10));

  // Approach 4: Dedupe by event_id first
  const dedupQuery = await clickhouse.query({
    query: `WITH 
              deduped AS (
                SELECT event_id,
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
                SELECT condition_id, outcome_index,
                  sum(usdc_delta) as cf, sum(token_delta) as tok, any(payout_norm) as res
                FROM deduped
                WHERE condition_id IS NOT NULL AND condition_id != ''
                GROUP BY condition_id, outcome_index
              )
            SELECT sum(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5)) as pnl FROM positions`,
    format: 'JSONEachRow'
  });
  const dedup = (await dedupQuery.json() as any[])[0];
  console.log('4. Deduped by event_id:         $' + Math.round(dedup.pnl).toLocaleString().padStart(10));

  // Approach 5: Sum deltas first (no dedupe needed if you sum)
  const sumQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT condition_id, outcome_index,
                sum(usdc_delta) / 3 as cf,  -- Divide by ~3 to account for triplication
                sum(token_delta) / 3 as tok,
                any(payout_norm) as res
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB' AND condition_id IS NOT NULL AND condition_id != ''
              GROUP BY condition_id, outcome_index
            )
            SELECT sum(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5)) as pnl FROM positions`,
    format: 'JSONEachRow'
  });
  const divBy3 = (await sumQuery.json() as any[])[0];
  console.log('5. Divided by 3 (test):         $' + Math.round(divBy3.pnl).toLocaleString().padStart(10));

  console.log('\n--- UI Target: $10,267.82 ---');
  console.log('');
  console.log('Delta from UI:');
  console.log('  V20 Current: ' + (Math.round(v20.pnl) - 10268 > 0 ? '+' : '') + (Math.round(v20.pnl) - 10268).toLocaleString());
  console.log('  Maker-only:  ' + (Math.round(maker.pnl) - 10268 > 0 ? '+' : '') + (Math.round(maker.pnl) - 10268).toLocaleString());
  console.log('  Taker-only:  ' + (Math.round(taker.pnl) - 10268 > 0 ? '+' : '') + (Math.round(taker.pnl) - 10268).toLocaleString());
  console.log('  Deduped:     ' + (Math.round(dedup.pnl) - 10268 > 0 ? '+' : '') + (Math.round(dedup.pnl) - 10268).toLocaleString());
  console.log('  Div by 3:    ' + (Math.round(divBy3.pnl) - 10268 > 0 ? '+' : '') + (Math.round(divBy3.pnl) - 10268).toLocaleString());
}

main().catch(console.error);
