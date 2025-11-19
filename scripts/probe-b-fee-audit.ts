#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 45000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PROBE B: FEE AUDIT");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check fee completeness
  console.log("1. FEE COMPLETENESS BY WALLET");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT 
      wallet,
      count() as total_markets,
      countIf(fee_usd IS NOT NULL AND fee_usd > 0) as markets_with_fee,
      countIf(slippage_usd IS NOT NULL AND slippage_usd > 0) as markets_with_slippage,
      round(sum(toFloat64(fee_usd)), 2) as total_fees,
      round(sum(toFloat64(slippage_usd)), 2) as total_slippage,
      round(countIf(fee_usd IS NOT NULL AND fee_usd > 0) * 100.0 / count(), 2) as fee_coverage_pct,
      round(countIf(slippage_usd IS NOT NULL AND slippage_usd > 0) * 100.0 / count(), 2) as slippage_coverage_pct
    FROM outcome_positions_v2
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet      | Markets | Fee Coverage | Fee$ | Slippage$ | Status`);
    console.log(`  ${"─".repeat(65)}`);
    for (const r of result) {
      const w = r[0].substring(0, 10);
      const markets = r[1];
      const fee_pct = r[6];
      const fee_total = parseFloat(r[4]).toFixed(2);
      const slip_total = parseFloat(r[5]).toFixed(2);
      const status = fee_pct < 80 ? "⚠️ INCOMPLETE" : "✅ GOOD";
      console.log(`  ${w}... | ${markets} | ${fee_pct}% | $${fee_total} | $${slip_total} | ${status}`);
    }
  }
  console.log("");

  // Three aggregates: no fees, with recorded fees, with estimated missing fees
  console.log("2. THREE P&L AGGREGATES");
  console.log("─".repeat(70));

  result = await queryData(`
    WITH win AS (
      SELECT 
        condition_id_norm, 
        toInt16(win_idx) AS win_idx
      FROM default.winning_index
    ),
    base_calc AS (
      SELECT 
        p.wallet,
        round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS pnl_before_fees,
        round(sum(toFloat64(coalesce(p.fee_usd, 0))), 2) as recorded_fees,
        round(sum(toFloat64(coalesce(p.slippage_usd, 0))), 2) as recorded_slippage
      FROM outcome_positions_v2 AS p
      ANY LEFT JOIN trade_cashflows_v3 AS c 
        ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
      ANY LEFT JOIN win AS w 
        ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
      WHERE w.win_idx IS NOT NULL AND p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
      GROUP BY p.wallet
    )
    SELECT 
      wallet,
      pnl_before_fees,
      pnl_before_fees - recorded_fees - recorded_slippage as pnl_with_recorded_fees,
      recorded_fees,
      recorded_slippage
    FROM base_calc
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet      | Before Fees | With Recorded Fees | Total Fees`);
    console.log(`  ${"─".repeat(70)}`);
    for (const r of result) {
      const w = r[0].substring(0, 10);
      const before = parseFloat(r[1]).toFixed(2);
      const with_fees = parseFloat(r[2]).toFixed(2);
      const total_fees = (parseFloat(r[3]) + parseFloat(r[4])).toFixed(2);
      const impact = parseFloat(r[1]) - parseFloat(r[2]);
      console.log(`  ${w}... | $${before} | $${with_fees} | -$${impact.toFixed(2)}`);
    }
  }
  console.log("");

  // Fee rate analysis for estimation
  console.log("3. MEDIAN FEE RATE BY MARKET (for estimation)");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      market_id,
      count() as trade_count,
      round(median(toFloat64(fee_usd)), 4) as median_fee,
      round(percentile(toFloat64(fee_usd), 0.75), 4) as p75_fee,
      round(percentile(toFloat64(fee_usd), 0.25), 4) as p25_fee
    FROM outcome_positions_v2
    WHERE fee_usd IS NOT NULL AND fee_usd > 0 
      AND wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY market_id
    ORDER BY median_fee DESC
    LIMIT 10
  `);

  if (result && result.length > 0) {
    console.log(`  Top markets by median fee:`);
    for (const r of result) {
      const market = r[0].substring(0, 20);
      const median = parseFloat(r[2]).toFixed(4);
      console.log(`    ${market}... : median=$${median}`);
    }
  }
  console.log("");

  console.log("4. CONCLUSION");
  console.log("─".repeat(70));
  console.log("  If 'With Recorded Fees' closes ≥50% of the gap to UI target,");
  console.log("  fees are the primary blocker and formula is correct.\n");
  console.log("  Otherwise, other factors (snapshot drift, coverage) are at play.\n");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
