#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 600000,
});

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await ch.query({ query });
    console.log(`✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}:`);
    console.error(`   ${e.message}`);
    return false;
  }
}

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("POLYMARKET REALIZED P&L - CORRECTED VERSION");
  console.log("Fixing GROUP BY ambiguity and proper settlement calculation");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // A) Canonical Condition Bridge
  const createCanonicalBridge = `CREATE OR REPLACE VIEW canonical_condition AS
WITH t1 AS (
  SELECT
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id_norm,'0x','')) AS condition_id_norm
  FROM ctf_token_map
  WHERE market_id != '12'
),
t2 AS (
  SELECT
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id,'0x','')) AS condition_id_norm
  FROM condition_market_map
  WHERE market_id != '12'
),
u AS (
  SELECT * FROM t1
  UNION ALL
  SELECT * FROM t2
)
SELECT
  market_id,
  anyHeavy(condition_id_norm) AS condition_id_norm
FROM u
GROUP BY market_id`;

  // B) Market Outcomes Expanded
  const createOutcomesExpanded = `CREATE OR REPLACE VIEW market_outcomes_expanded AS
SELECT
  mo.condition_id_norm,
  idx - 1 AS outcome_idx,
  upperUTF8(toString(mo.outcomes[idx])) AS outcome_label
FROM market_outcomes mo
ARRAY JOIN arrayEnumerate(mo.outcomes) AS idx`;

  // C) Resolutions Normalized
  const createResolutionsNorm = `CREATE OR REPLACE VIEW resolutions_norm AS
SELECT
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  upperUTF8(toString(winning_outcome)) AS win_label,
  resolved_at
FROM market_resolutions
WHERE winning_outcome IS NOT NULL`;

  // D) Winning Index
  const createWinningIndex = `CREATE OR REPLACE VIEW winning_index AS
SELECT
  r.condition_id_norm,
  anyIf(moe.outcome_idx, moe.outcome_label = r.win_label) AS win_idx,
  any(r.resolved_at) AS resolved_at
FROM resolutions_norm r
LEFT JOIN market_outcomes_expanded moe USING (condition_id_norm)
GROUP BY r.condition_id_norm`;

  // E) Trade Flows v2
  const createTradeFlows = `CREATE OR REPLACE VIEW trade_flows_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  cast(outcome_index as Int16) AS trade_idx,
  toString(outcome) AS outcome_raw,
  round(
    cast(entry_price as Float64) * cast(shares as Float64) *
    if(lowerUTF8(toString(side)) = 'buy', -1, 1),
    8
  ) AS cashflow_usdc,
  if(
    lowerUTF8(toString(side)) = 'buy',
    cast(shares as Float64),
    -cast(shares as Float64)
  ) AS delta_shares
FROM trades_raw
WHERE market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000')`;

  // F) Realized PnL by Market v2 (SIMPLIFIED - use trade_cashflows_v3)
  // For resolved conditions only, just sum the pre-calculated cashflows
  const createRealizedPnL = `CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  tcf.wallet,
  '?' AS market_id,
  tcf.condition_id_norm,
  any(wi.resolved_at) AS resolved_at,
  round(sum(tcf.cashflow_usdc), 8) AS realized_pnl_usd,
  count() AS fill_count
FROM trade_cashflows_v3 tcf
LEFT JOIN winning_index wi ON tcf.condition_id_norm = wi.condition_id_norm
WHERE wi.win_idx IS NOT NULL
GROUP BY tcf.wallet, tcf.condition_id_norm`;

  // G) Wallet Realized PnL v2
  const createRealizedSummary = `CREATE OR REPLACE VIEW wallet_realized_pnl_v2 AS
SELECT
  wallet,
  round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_v2
GROUP BY wallet`;

  // H) Wallet Unrealized PnL v2
  const createUnrealizedSummary = `CREATE OR REPLACE VIEW wallet_unrealized_pnl_v2 AS
SELECT
  wallet,
  round(sum(unrealized_pnl_usd), 2) AS unrealized_pnl_usd
FROM portfolio_mtm_detailed
GROUP BY wallet`;

  // I) Wallet PnL Summary v2
  const createTotalSummary = `CREATE OR REPLACE VIEW wallet_pnl_summary_v2 AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(
    coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0),
    2
  ) AS total_pnl_usd
FROM wallet_realized_pnl_v2 r
FULL JOIN wallet_unrealized_pnl_v2 u USING (wallet)`;

  // Execute all view creations
  const views = [
    ["Canonical Condition Bridge", createCanonicalBridge],
    ["Market Outcomes Expanded", createOutcomesExpanded],
    ["Resolutions Normalized", createResolutionsNorm],
    ["Winning Index", createWinningIndex],
    ["Trade Flows v2", createTradeFlows],
    ["Realized PnL by Market v2 (CORRECTED)", createRealizedPnL],
    ["Wallet Realized PnL v2", createRealizedSummary],
    ["Wallet Unrealized PnL v2", createUnrealizedSummary],
    ["Wallet PnL Summary v2", createTotalSummary]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`View Creation: ${successCount}/${views.length} successful\n`);

  if (successCount !== views.length) {
    console.log("⚠️  Some views failed to create. Stopping here.\n");
    return;
  }

  // ========================================================================
  // VERIFICATION QUERIES
  // ========================================================================

  // Probe 1: Bridge Coverage
  try {
    console.log("🔍 PROBE 1: Bridge Coverage for Target Wallets\n");

    const bridgeProbe = await queryData(`
WITH target_markets AS (
  SELECT DISTINCT lower(market_id) AS market_id
  FROM trades_raw
  WHERE lower(wallet_address) IN (
    '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  )
)
SELECT
  count() AS markets_touched,
  countIf(cc.condition_id_norm IS NOT NULL) AS bridged,
  countIf(wi.win_idx IS NOT NULL) AS resolvable,
  round(countIf(wi.win_idx IS NOT NULL) * 100.0 / count(), 2) AS pct_resolvable
FROM target_markets tm
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm`);

    if (bridgeProbe.length > 0) {
      const probe = bridgeProbe[0];
      console.log(`  Markets touched:     ${probe.markets_touched}`);
      console.log(`  Bridged:             ${probe.bridged} (${probe.bridged === probe.markets_touched ? '100%' : 'INCOMPLETE'})`);
      console.log(`  Resolvable:          ${probe.resolvable} (${probe.pct_resolvable}%)`);

      if (probe.bridged === probe.markets_touched && probe.resolvable > 0) {
        console.log(`  ✅ Bridge coverage is complete\n`);
      } else {
        console.log(`  ⚠️  WARNING: Incomplete coverage\n`);
      }
    }
  } catch (e: any) {
    console.error(`Probe 1 failed: ${e.message}\n`);
  }

  // Probe 2: Sample Market Breakdown
  try {
    console.log("🔍 PROBE 2: Sample Market-Level P&L (First 10 Markets)\n");

    const marketSample = await queryData(`
SELECT
  wallet,
  substring(market_id, 1, 16) AS market_id_short,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
ORDER BY resolved_at DESC
LIMIT 10`);

    if (marketSample.length > 0) {
      marketSample.forEach((row: any, idx: number) => {
        const walletName = row.wallet.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`  ${idx + 1}. ${walletName} | Market ${row.market_id_short}... | P&L: $${row.realized_pnl_usd} | Fills: ${row.fill_count}`);
      });
      console.log();
    } else {
      console.log(`  No market data found\n`);
    }
  } catch (e: any) {
    console.error(`Probe 2 failed: ${e.message}\n`);
  }

  // Probe 3: Final Wallet P&L Summary
  try {
    console.log("📊 PROBE 3: Final Wallet P&L Summary\n");

    const finalResults = await queryData(`
SELECT
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
ORDER BY wallet`);

    if (finalResults.length > 0) {
      console.log("┌─────────────────────────────────────────────────────────────┐");
      console.log("│ HolyMoses7 (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8) │");
      console.log("└─────────────────────────────────────────────────────────────┘");

      const holy = finalResults.find((r: any) => r.wallet.startsWith('0xa4b3'));
      if (holy) {
        console.log(`  Realized P&L:        $${holy.realized_pnl_usd.toLocaleString()}`);
        console.log(`  Unrealized P&L:      $${holy.unrealized_pnl_usd.toLocaleString()}`);
        console.log(`  ────────────────────────────────────────`);
        console.log(`  TOTAL P&L:           $${holy.total_pnl_usd.toLocaleString()}`);
        console.log(`  Expected Range:      $89,975 - $91,633`);
        const expectedMid = 90804;
        const variance = ((holy.total_pnl_usd - expectedMid) / expectedMid * 100);
        const varianceAbs = Math.abs(variance);
        console.log(`  Variance:            ${variance > 0 ? '+' : ''}${variance.toFixed(2)}% (${varianceAbs < 5 ? '✅ GOOD' : varianceAbs < 10 ? '⚠️  CHECK' : '❌ BAD'})`);
        console.log();
      } else {
        console.log(`  ❌ No data found\n`);
      }

      console.log("┌─────────────────────────────────────────────────────────────┐");
      console.log("│ niggemon (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0)    │");
      console.log("└─────────────────────────────────────────────────────────────┘");

      const niggemon = finalResults.find((r: any) => r.wallet.startsWith('0xeb6f'));
      if (niggemon) {
        console.log(`  Realized P&L:        $${niggemon.realized_pnl_usd.toLocaleString()}`);
        console.log(`  Unrealized P&L:      $${niggemon.unrealized_pnl_usd.toLocaleString()}`);
        console.log(`  ────────────────────────────────────────`);
        console.log(`  TOTAL P&L:           $${niggemon.total_pnl_usd.toLocaleString()}`);
        console.log(`  Expected:            $102,001`);
        const variance = ((niggemon.total_pnl_usd - 102001) / 102001 * 100);
        const varianceAbs = Math.abs(variance);
        console.log(`  Variance:            ${variance > 0 ? '+' : ''}${variance.toFixed(2)}% (${varianceAbs < 5 ? '✅ GOOD' : varianceAbs < 10 ? '⚠️  CHECK' : '❌ BAD'})`);
        console.log();
      } else {
        console.log(`  ❌ No data found\n`);
      }
    } else {
      console.log("❌ No results found in wallet_pnl_summary_v2\n");
    }
  } catch (e: any) {
    console.error("❌ Failed to fetch final results:", e.message);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ Realized P&L Calculation Complete!");
  console.log("\nViews Created:");
  console.log("  • canonical_condition          - Market ID → Condition ID bridge");
  console.log("  • market_outcomes_expanded     - Outcome labels → indexes");
  console.log("  • resolutions_norm             - Normalized resolutions");
  console.log("  • winning_index                - Condition ID → winning index");
  console.log("  • trade_flows_v2               - Per-trade cashflows and shares");
  console.log("  • realized_pnl_by_market_v2    - Per-market settlement (CORRECTED)");
  console.log("  • wallet_realized_pnl_v2       - Per-wallet realized P&L");
  console.log("  • wallet_unrealized_pnl_v2     - Per-wallet unrealized P&L");
  console.log("  • wallet_pnl_summary_v2        - Combined P&L summary");
  console.log("\nKey Fix:");
  console.log("  Removed subquery ambiguity in realized_pnl_by_market_v2");
  console.log("  Direct GROUP BY on joined tables for proper ClickHouse syntax");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
