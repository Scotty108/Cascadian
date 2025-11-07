#!/usr/bin/env npx tsx

/**
 * TRUTH CHECK: Non-destructive database validation
 *
 * Purpose: Verify the +1 offset hypothesis and check data quality
 * WITHOUT making any changes to the database
 *
 * Run exactly as specified by the user
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

const NIGGEMON = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

async function queryData(query: string) {
  try {
    const result = await client.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`  Query error: ${e.message?.substring(0, 300)}`);
    return [];
  }
}

async function runTruthCheck() {
  console.log('\n' + '='.repeat(80));
  console.log('TRUTH CHECK: Validating +1 Offset Hypothesis');
  console.log('='.repeat(80));

  try {
    // ========================================================================
    // T1: Are the "final" tables empty?
    // ========================================================================
    console.log('\n[T1] Are the "final" tables empty?');
    console.log('-'.repeat(80));

    const t1 = await queryData(`
      SELECT 'wallet_pnl_summary_final' AS table_name, count() AS row_count FROM wallet_pnl_summary_final
      UNION ALL
      SELECT 'realized_pnl_by_market_v2', count() FROM realized_pnl_by_market_v2
      UNION ALL
      SELECT 'trade_flows_v2', count() FROM trade_flows_v2
      ORDER BY table_name
    `);

    t1.forEach((row: any) => {
      console.log(`  ${row.table_name}: ${row.row_count.toLocaleString()} rows`);
    });

    // ========================================================================
    // T2: What do you actually have in trade_flows_v2?
    // ========================================================================
    console.log('\n[T2] Cashflow totals in trade_flows_v2');
    console.log('-'.repeat(80));

    const t2 = await queryData(`
      SELECT
        count() AS total_rows,
        sum(toFloat64(cashflow_usdc)) AS cash_sum
      FROM trade_flows_v2
    `);

    if (t2.length > 0) {
      const row = t2[0];
      console.log(`  Total rows: ${row.total_rows.toLocaleString()}`);
      console.log(`  Sum of cashflows: $${(row.cash_sum || 0).toFixed(2)}`);
    }

    // ========================================================================
    // T3: Cashflow sign sanity
    // ========================================================================
    console.log('\n[T3] Cashflow sign sanity (BUY vs SELL)');
    console.log('-'.repeat(80));

    const t3 = await queryData(`
      SELECT
        sumIf(toFloat64(cashflow_usdc), upperUTF8(side)='BUY') AS sum_buy,
        sumIf(toFloat64(cashflow_usdc), upperUTF8(side)='SELL') AS sum_sell
      FROM trade_flows_v2
    `);

    if (t3.length > 0) {
      const row = t3[0];
      console.log(`  BUY cashflows: $${(row.sum_buy || 0).toFixed(2)}`);
      console.log(`  SELL cashflows: $${(row.sum_sell || 0).toFixed(2)}`);
      console.log(`  Interpretation: BUY should be negative (cost), SELL should be positive (revenue)`);
    }

    // ========================================================================
    // T4: Index offset detector
    // ========================================================================
    console.log('\n[T4] Index offset detector (the critical test)');
    console.log('-'.repeat(80));

    const t4 = await queryData(`
      WITH p AS (
        SELECT lower(condition_id_norm) AS cid, toInt16(outcome_idx) AS oidx, wallet
        FROM outcome_positions_v2
      ),
      w AS (
        SELECT lower(condition_id_norm) AS cid, toInt16(win_idx) AS widx
        FROM winning_index
        WHERE win_idx IS NOT NULL
      )
      SELECT
        count() as total_rows,
        sum(oidx = widx) AS exact_match,
        sum(oidx = widx + 1) AS plus1_offset,
        sum(oidx + 1 = widx) AS minus1_offset
      FROM p JOIN w USING (cid)
    `);

    if (t4.length > 0) {
      const row = t4[0];
      const total = row.total_rows || 1;
      console.log(`  Total position-outcome pairs: ${total.toLocaleString()}`);
      console.log(`  Exact match (oidx = widx): ${row.exact_match} (${((row.exact_match / total) * 100).toFixed(2)}%)`);
      console.log(`  +1 offset (oidx = widx + 1): ${row.plus1_offset} (${((row.plus1_offset / total) * 100).toFixed(2)}%)`);
      console.log(`  -1 offset (oidx + 1 = widx): ${row.minus1_offset} (${((row.minus1_offset / total) * 100).toFixed(2)}%)`);
      console.log(`  \n  ⚠️  KEY FINDING: ${row.plus1_offset > row.exact_match ? '✅ +1 OFFSET DOMINATES' : '❌ EXACT MATCH DOMINATES'}`);
    }

    // ========================================================================
    // T5: Is canonical_condition causing fanout?
    // ========================================================================
    console.log('\n[T5] Fanout risk in canonical_condition mapping');
    console.log('-'.repeat(80));

    const t5 = await queryData(`
      SELECT
        count() AS total_mappings,
        uniqExact(lower(market_id)) AS unique_markets,
        avg(cc_rows) AS avg_rows_per_market,
        max(cc_rows) AS max_rows_per_market
      FROM (
        SELECT lower(market_id) AS market_id, count() AS cc_rows
        FROM canonical_condition
        GROUP BY market_id
      )
    `);

    if (t5.length > 0) {
      const row = t5[0];
      console.log(`  Total mappings: ${row.total_mappings.toLocaleString()}`);
      console.log(`  Unique markets: ${row.unique_markets.toLocaleString()}`);
      console.log(`  Avg mappings per market: ${(row.avg_rows_per_market || 0).toFixed(2)}`);
      console.log(`  Max mappings per market: ${row.max_rows_per_market}`);
      console.log(`  \n  ⚠️  FANOUT RISK: ${row.avg_rows_per_market > 1.1 ? '⚠️  HIGH (avg > 1)' : '✅ LOW (avg ≈ 1)'}`);
    }

    // ========================================================================
    // T6: Wallet scope reality check
    // ========================================================================
    console.log('\n[T6] Wallet scope reality check (niggemon)');
    console.log('-'.repeat(80));

    const t6 = await queryData(`
      SELECT
        sum(toFloat64(cashflow_usdc)) AS cash_all,
        sumIf(toFloat64(cashflow_usdc), lower(wallet)=lower('${NIGGEMON}')) AS cash_niggemon,
        count() AS total_trades,
        countIf(lower(wallet)=lower('${NIGGEMON}')) AS niggemon_trades
      FROM trade_flows_v2
    `);

    if (t6.length > 0) {
      const row = t6[0];
      console.log(`  Total system cashflows: $${(row.cash_all || 0).toFixed(2)}`);
      console.log(`  niggemon cashflows: $${(row.cash_niggemon || 0).toFixed(2)}`);
      console.log(`  Niggemon's share: ${((row.cash_niggemon || 0) / (row.cash_all || 1) * 100).toFixed(2)}%`);
      console.log(`  Total trades in system: ${row.total_trades.toLocaleString()}`);
      console.log(`  niggemon trades: ${row.niggemon_trades.toLocaleString()}`);
    }

    // ========================================================================
    // BONUS: Current wallet P&L values
    // ========================================================================
    console.log('\n[BONUS] Current wallet P&L values');
    console.log('-'.repeat(80));

    const bonus = await queryData(`
      SELECT wallet, realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd
      FROM wallet_pnl_summary_v2
      WHERE lower(wallet) = lower('${NIGGEMON}')
    `);

    if (bonus.length > 0) {
      const row = bonus[0];
      console.log(`  Realized P&L: $${(row.realized_pnl_usd || 0).toFixed(2)}`);
      console.log(`  Unrealized P&L: $${(row.unrealized_pnl_usd || 0).toFixed(2)}`);
      console.log(`  Total P&L: $${(row.total_pnl_usd || 0).toFixed(2)}`);
    } else {
      console.log(`  No data found for niggemon in wallet_pnl_summary_v2`);
    }

    // ========================================================================
    // VERDICT
    // ========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('VERDICT');
    console.log('='.repeat(80));
    console.log(`
If T4 shows +1 offset dominates (>90%):
  ✅ The +1 fix should work - go ahead with the one-line change

If T4 shows exact match dominates (>90%):
  ❌ The +1 fix won't help - need the full rebuild from first principles

If T1 shows tables are empty:
  ⚠️  No data to test - verify backfill completed successfully

If T5 shows high fanout (avg > 1):
  ⚠️  Join multiplier risk - must use the fanout-safe rebuild approach

Look at these results and decide next steps.
    `);

  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

runTruthCheck().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
