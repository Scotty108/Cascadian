import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Investigating @ForgetAboutBenjamin Overcount ===');
  console.log('Wallet:', wallet);
  console.log('UI PnL: +$10,267.82');
  console.log('V20 PnL: +$31,257.20');
  console.log('Delta: +$20,989 (3x too high)\n');

  // 1. Check total row count and unique event_ids
  const countQuery = await clickhouse.query({
    query: `SELECT 
              count() as total_rows,
              countDistinct(event_id) as unique_events,
              countDistinct(condition_id) as unique_markets
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'`,
    format: 'JSONEachRow'
  });
  const counts = (await countQuery.json() as any[])[0];
  console.log('1. Row counts:');
  console.log('   Total rows:', counts.total_rows);
  console.log('   Unique events:', counts.unique_events);
  console.log('   Unique markets:', counts.unique_markets);
  console.log('   Duplication factor:', (counts.total_rows / counts.unique_events).toFixed(2) + 'x');
  console.log('');

  // 2. Check for duplicate event_ids
  const dupesQuery = await clickhouse.query({
    query: `SELECT event_id, count() as cnt
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'
            GROUP BY event_id
            HAVING cnt > 1
            LIMIT 10`,
    format: 'JSONEachRow'
  });
  const dupes = await dupesQuery.json() as any[];
  console.log('2. Duplicate event_ids (sample):');
  if (dupes.length === 0) {
    console.log('   No duplicates found');
  } else {
    dupes.slice(0, 5).forEach((d: any) => console.log('   ' + d.event_id.slice(0, 30) + '... (x' + d.cnt + ')'));
  }
  console.log('');

  // 3. Check role distribution
  const roleQuery = await clickhouse.query({
    query: `SELECT role, count() as cnt, sum(usdc_delta) as total_usdc
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'
            GROUP BY role`,
    format: 'JSONEachRow'
  });
  const roles = await roleQuery.json() as any[];
  console.log('3. Role distribution:');
  roles.forEach((r: any) => console.log('   ' + r.role + ': ' + r.cnt + ' rows, $' + Math.round(r.total_usdc) + ' USDC delta'));
  console.log('');

  // 4. Check V20's position aggregation
  const posQuery = await clickhouse.query({
    query: `SELECT 
              condition_id,
              outcome_index,
              sum(usdc_delta) as cash_flow,
              sum(token_delta) as final_tokens,
              any(payout_norm) as resolution,
              count() as trade_count
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'
              AND condition_id IS NOT NULL
            GROUP BY condition_id, outcome_index
            ORDER BY abs(cash_flow) DESC
            LIMIT 10`,
    format: 'JSONEachRow'
  });
  const positions = await posQuery.json() as any[];
  console.log('4. Top 10 positions by cash flow (V20 aggregation):');
  let totalPnl = 0;
  positions.forEach((p: any) => {
    const resolved = p.resolution !== null;
    const pnl = resolved 
      ? p.cash_flow + p.final_tokens * p.resolution
      : p.cash_flow + p.final_tokens * 0.5;
    totalPnl += pnl;
    console.log('   ' + p.condition_id.slice(0, 12) + '... [' + p.outcome_index + '] ' + 
                (resolved ? 'R' : 'U') + ': $' + Math.round(pnl) + 
                ' (cf=' + Math.round(p.cash_flow) + ', tok=' + Math.round(p.final_tokens) + ', trades=' + p.trade_count + ')');
  });
  console.log('');

  // 5. Check total PnL computed at SQL level
  const pnlQuery = await clickhouse.query({
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
              GROUP BY condition_id, outcome_index
            )
            SELECT 
              sum(if(resolution IS NOT NULL, cash_flow + final_tokens * resolution, 0)) as realized,
              sum(if(resolution IS NULL, cash_flow + final_tokens * 0.5, 0)) as unrealized,
              count() as positions
            FROM positions`,
    format: 'JSONEachRow'
  });
  const pnl = (await pnlQuery.json() as any[])[0];
  console.log('5. V20 SQL-level PnL:');
  console.log('   Realized: $' + Math.round(pnl.realized));
  console.log('   Unrealized: $' + Math.round(pnl.unrealized));
  console.log('   Total: $' + Math.round(pnl.realized + pnl.unrealized));
  console.log('   Positions:', pnl.positions);
}

main().catch(console.error);
