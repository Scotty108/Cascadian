import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Checking Role Duplication Pattern ===\n');

  // 1. Count events with maker+taker vs same-role dupes
  const mixedQuery = await clickhouse.query({
    query: `SELECT 
              event_id,
              countDistinct(role) as unique_roles,
              count() as row_count,
              min(role) as role1,
              max(role) as role2
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'
            GROUP BY event_id
            HAVING row_count > 1
            ORDER BY row_count DESC
            LIMIT 20`,
    format: 'JSONEachRow'
  });
  const mixed = await mixedQuery.json() as any[];
  
  let sameRoleCount = 0;
  let diffRoleCount = 0;
  
  console.log('Sample duplicate events:');
  mixed.slice(0, 10).forEach((m: any) => {
    const isDiff = m.unique_roles > 1;
    if (isDiff) diffRoleCount++;
    else sameRoleCount++;
    console.log('  ' + m.event_id.slice(0, 30) + '... x' + m.row_count + 
                ' roles: ' + m.role1 + (isDiff ? '+' + m.role2 : '') +
                (isDiff ? ' ← MAKER+TAKER!' : ''));
  });

  // Count totals
  const totalQuery = await clickhouse.query({
    query: `SELECT 
              countIf(unique_roles > 1) as diff_role_events,
              countIf(unique_roles = 1) as same_role_events,
              sum(row_count) as total_dupe_rows
            FROM (
              SELECT event_id, countDistinct(role) as unique_roles, count() as row_count
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB'
              GROUP BY event_id
              HAVING row_count > 1
            )`,
    format: 'JSONEachRow'
  });
  const totals = (await totalQuery.json() as any[])[0];
  
  console.log('\n--- Duplication Summary ---');
  console.log('Events with MAKER+TAKER dupes:', totals.diff_role_events);
  console.log('Events with same-role dupes:', totals.same_role_events);
  console.log('Total duplicate rows:', totals.total_dupe_rows);

  // 2. Calculate PnL with deduplication by event_id
  console.log('\n=== PnL with Event-Level Deduplication ===');
  const dedupQuery = await clickhouse.query({
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
                  AND condition_id IS NOT NULL
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
                GROUP BY condition_id, outcome_index
              )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, 0)) as realized,
              sum(if(resolution IS NULL, cash_flow + final_tokens * 0.5, 0)) as unrealized,
              count() as positions
            FROM positions`,
    format: 'JSONEachRow'
  });
  const dedup = (await dedupQuery.json() as any[])[0];
  console.log('Deduped Realized: $' + Math.round(dedup.realized));
  console.log('Deduped Unrealized: $' + Math.round(dedup.unrealized));
  console.log('Deduped Total: $' + Math.round(dedup.realized + dedup.unrealized));
  console.log('Deduped Positions:', dedup.positions);

  // 3. What if we only use maker rows?
  console.log('\n=== PnL with Maker-Only Filter ===');
  const makerQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT
                condition_id,
                outcome_index,
                sum(usdc_delta) as cash_flow,
                sum(token_delta) as final_tokens,
                any(payout_norm) as resolution
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB'
                AND condition_id IS NOT NULL
                AND role = 'maker'
              GROUP BY condition_id, outcome_index
            )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, 0)) as realized,
              sum(if(resolution IS NULL, cash_flow + final_tokens * 0.5, 0)) as unrealized,
              count() as positions
            FROM positions`,
    format: 'JSONEachRow'
  });
  const maker = (await makerQuery.json() as any[])[0];
  console.log('Maker-only Realized: $' + Math.round(maker.realized));
  console.log('Maker-only Unrealized: $' + Math.round(maker.unrealized));
  console.log('Maker-only Total: $' + Math.round(maker.realized + maker.unrealized));
  console.log('Maker-only Positions:', maker.positions);

  // 4. What if we only use taker rows?
  console.log('\n=== PnL with Taker-Only Filter ===');
  const takerQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT
                condition_id,
                outcome_index,
                sum(usdc_delta) as cash_flow,
                sum(token_delta) as final_tokens,
                any(payout_norm) as resolution
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB'
                AND condition_id IS NOT NULL
                AND role = 'taker'
              GROUP BY condition_id, outcome_index
            )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, 0)) as realized,
              sum(if(resolution IS NULL, cash_flow + final_tokens * 0.5, 0)) as unrealized,
              count() as positions
            FROM positions`,
    format: 'JSONEachRow'
  });
  const taker = (await takerQuery.json() as any[])[0];
  console.log('Taker-only Realized: $' + Math.round(taker.realized));
  console.log('Taker-only Unrealized: $' + Math.round(taker.unrealized));
  console.log('Taker-only Total: $' + Math.round(taker.realized + taker.unrealized));
  console.log('Taker-only Positions:', taker.positions);

  // 5. Compare to UI target
  console.log('\n=== Comparison to UI ===');
  console.log('UI Net total: $10,267.82');
  console.log('');
  console.log('V20 (all roles, no dedupe): $31,257 - OFF by $20,989');
  console.log('Deduped by event_id: $' + Math.round(dedup.realized + dedup.unrealized));
  console.log('Maker-only: $' + Math.round(maker.realized + maker.unrealized));
  console.log('Taker-only: $' + Math.round(taker.realized + taker.unrealized));
}

main().catch(console.error);
