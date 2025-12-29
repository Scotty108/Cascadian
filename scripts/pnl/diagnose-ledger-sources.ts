/**
 * Diagnose ledger data sources for a wallet
 * Shows what data is in each ledger table to understand discrepancies
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a'; // darkrider11

async function main() {
  console.log(`\n=== Ledger Diagnosis for ${WALLET} ===\n`);

  // 1. Check V7 (what V20 uses)
  console.log('1. pm_unified_ledger_v7 (V20 uses this):');
  try {
    const v7Query = await clickhouse.query({
      query: `
        SELECT
          source_type,
          count() as cnt,
          sum(usdc_delta) as total_usdc,
          sum(token_delta) as total_tokens,
          countDistinct(condition_id) as markets
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${WALLET}')
        GROUP BY source_type
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const v7Rows = await v7Query.json() as any[];
    if (v7Rows.length > 0) {
      for (const row of v7Rows) {
        console.log(`   ${row.source_type}: ${row.cnt} rows, USDC: $${Number(row.total_usdc).toLocaleString()}, Tokens: ${Number(row.total_tokens).toLocaleString()}, Markets: ${row.markets}`);
      }
    } else {
      console.log('   NO DATA');
    }
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  // 2. Check V8 (full ledger with CTF)
  console.log('\n2. pm_unified_ledger_v8_tbl (full ledger):');
  try {
    const v8Query = await clickhouse.query({
      query: `
        SELECT
          source_type,
          count() as cnt,
          sum(usdc_delta) as total_usdc,
          sum(token_delta) as total_tokens,
          countDistinct(condition_id) as markets
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower('${WALLET}')
        GROUP BY source_type
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const v8Rows = await v8Query.json() as any[];
    for (const row of v8Rows) {
      console.log(`   ${row.source_type}: ${row.cnt} rows, USDC: $${Number(row.total_usdc).toLocaleString()}, Tokens: ${Number(row.total_tokens).toLocaleString()}, Markets: ${row.markets}`);
    }
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  // 3. Check V9 CLOB-only (canonical for leaderboard)
  console.log('\n3. pm_unified_ledger_v9_clob_tbl (CLOB-only canonical):');
  try {
    const v9Query = await clickhouse.query({
      query: `
        SELECT
          source_type,
          count() as cnt,
          sum(usdc_delta) as total_usdc,
          sum(token_delta) as total_tokens,
          countDistinct(condition_id) as markets
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${WALLET}')
        GROUP BY source_type
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const v9Rows = await v9Query.json() as any[];
    for (const row of v9Rows) {
      console.log(`   ${row.source_type}: ${row.cnt} rows, USDC: $${Number(row.total_usdc).toLocaleString()}, Tokens: ${Number(row.total_tokens).toLocaleString()}, Markets: ${row.markets}`);
    }
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  // 4. Run a V20-style query on V9 to see what we'd get
  console.log('\n4. V20 Formula on V9 (corrected data source):');
  try {
    const correctQuery = await clickhouse.query({
      query: `
        WITH
          positions AS (
            SELECT
              condition_id,
              outcome_index,
              sum(usdc_delta) AS cash_flow,
              sum(token_delta) AS final_tokens,
              any(payout_norm) AS resolution_price
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${WALLET}')
              AND source_type = 'CLOB'
              AND condition_id IS NOT NULL
              AND condition_id != ''
            GROUP BY condition_id, outcome_index
          ),
          position_pnl AS (
            SELECT
              condition_id,
              cash_flow,
              final_tokens,
              resolution_price,
              if(resolution_price IS NOT NULL,
                 round(cash_flow + final_tokens * resolution_price, 2),
                 0) AS pos_realized_pnl,
              if(resolution_price IS NULL,
                 round(cash_flow + final_tokens * 0.5, 2),
                 0) AS pos_unrealized_pnl,
              if(resolution_price IS NOT NULL, 1, 0) AS is_resolved
            FROM positions
          )
        SELECT
          sum(pos_realized_pnl) AS realized_pnl,
          sum(pos_unrealized_pnl) AS unrealized_pnl,
          sum(pos_realized_pnl) + sum(pos_unrealized_pnl) AS total_pnl,
          count() AS position_count,
          sumIf(1, is_resolved = 1) AS resolved_count
        FROM position_pnl
      `,
      format: 'JSONEachRow'
    });
    const rows = await correctQuery.json() as any[];
    if (rows.length > 0) {
      console.log(`   Total PnL:      $${Number(rows[0].total_pnl).toLocaleString()}`);
      console.log(`   Realized PnL:   $${Number(rows[0].realized_pnl).toLocaleString()}`);
      console.log(`   Unrealized PnL: $${Number(rows[0].unrealized_pnl).toLocaleString()}`);
      console.log(`   Positions:      ${rows[0].position_count}`);
      console.log(`   Resolved:       ${rows[0].resolved_count}`);
    }
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  // 5. Raw cash flow from CLOB events only
  console.log('\n5. Raw CLOB Cash Flow (simple sum):');
  try {
    const cashQuery = await clickhouse.query({
      query: `
        SELECT
          sum(usdc_delta) as net_usdc,
          sum(if(usdc_delta > 0, usdc_delta, 0)) as usdc_in,
          sum(if(usdc_delta < 0, usdc_delta, 0)) as usdc_out
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'CLOB'
      `,
      format: 'JSONEachRow'
    });
    const rows = await cashQuery.json() as any[];
    if (rows.length > 0) {
      console.log(`   Net USDC:  $${Number(rows[0].net_usdc).toLocaleString()}`);
      console.log(`   USDC In:   $${Number(rows[0].usdc_in).toLocaleString()}`);
      console.log(`   USDC Out:  $${Number(rows[0].usdc_out).toLocaleString()}`);
    }
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  console.log('\n=== Expected UI Value: +$604,472 ===\n');
}

main().catch(console.error);
