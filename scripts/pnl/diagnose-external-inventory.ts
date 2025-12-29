import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== External Inventory Diagnostic ===');
  console.log('Looking for positions where sells > buys (phantom profit)\n');

  // Find positions where token_delta is negative (net seller) but they profited
  const externalQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT 
                condition_id,
                outcome_index,
                sum(usdc_delta) as cash_flow,
                sum(token_delta) as net_tokens,
                sumIf(token_delta, token_delta > 0) as total_bought,
                sumIf(abs(token_delta), token_delta < 0) as total_sold,
                any(payout_norm) as resolution,
                count() as trade_count
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB'
                AND condition_id IS NOT NULL
              GROUP BY condition_id, outcome_index
            )
            SELECT 
              condition_id,
              outcome_index,
              cash_flow,
              net_tokens,
              total_bought,
              total_sold,
              resolution,
              trade_count,
              -- PnL computed by V20
              if(resolution IS NOT NULL, 
                 cash_flow + net_tokens * resolution, 
                 cash_flow + net_tokens * 0.5) as v20_pnl,
              -- External inventory: sold more than bought
              total_sold - total_bought as external_sold
            FROM positions
            WHERE total_sold > total_bought * 1.1  -- Sold 10%+ more than bought
            ORDER BY abs(v20_pnl) DESC
            LIMIT 15`,
    format: 'JSONEachRow'
  });
  const externals = await externalQuery.json() as any[];
  
  console.log('Positions with SELLS > BUYS (external inventory):');
  console.log('cond_id          | out | bought | sold   | external | V20 PnL');
  console.log('-----------------|-----|--------|--------|----------|--------');
  
  let totalExternalPnl = 0;
  externals.forEach((e: any) => {
    totalExternalPnl += e.v20_pnl;
    console.log(
      e.condition_id.slice(0, 16) + ' | ' +
      String(e.outcome_index).padStart(3) + ' | ' +
      Math.round(e.total_bought).toLocaleString().padStart(6) + ' | ' +
      Math.round(e.total_sold).toLocaleString().padStart(6) + ' | ' +
      Math.round(e.external_sold).toLocaleString().padStart(8) + ' | ' +
      '$' + Math.round(e.v20_pnl).toLocaleString().padStart(6)
    );
  });
  
  console.log('\nTotal PnL from external-inventory positions: $' + Math.round(totalExternalPnl).toLocaleString());

  // Now check how much of total PnL comes from these external positions
  const totalQuery = await clickhouse.query({
    query: `WITH positions AS (
              SELECT condition_id, outcome_index,
                sum(usdc_delta) as cf, sum(token_delta) as tok, any(payout_norm) as res,
                sumIf(token_delta, token_delta > 0) as bought,
                sumIf(abs(token_delta), token_delta < 0) as sold
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB' AND condition_id IS NOT NULL
              GROUP BY condition_id, outcome_index
            )
            SELECT 
              sum(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5)) as total_pnl,
              sumIf(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5), sold > bought * 1.1) as external_pnl,
              sumIf(if(res IS NOT NULL, cf + tok * res, cf + tok * 0.5), sold <= bought * 1.1) as clean_pnl
            FROM positions`,
    format: 'JSONEachRow'
  });
  const totals = (await totalQuery.json() as any[])[0];
  
  console.log('\n=== PnL Breakdown ===');
  console.log('Total V20 PnL:     $' + Math.round(totals.total_pnl).toLocaleString());
  console.log('External Inv PnL:  $' + Math.round(totals.external_pnl).toLocaleString());
  console.log('Clean PnL:         $' + Math.round(totals.clean_pnl).toLocaleString());
  console.log('');
  console.log('UI Target:         $10,268');
  console.log('If we exclude external: $' + Math.round(totals.clean_pnl).toLocaleString() + 
              ' (delta: ' + (Math.round(totals.clean_pnl) - 10268 > 0 ? '+' : '') + 
              (Math.round(totals.clean_pnl) - 10268).toLocaleString() + ')');
}

main().catch(console.error);
