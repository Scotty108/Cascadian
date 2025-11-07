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
    console.error(`❌ ${name}: ${e.message?.substring(0, 200)}`);
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
  console.log("REALIZED P&L - CANONICAL BRIDGE (FIXED WITH FLOAT64)");
  console.log("Settlement: cost_basis + winning_payout per market");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // A) Build canonical bridge (already created, reuse)
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

  // B) Expand outcomes to index labels
  const createOutcomesExpanded = `CREATE OR REPLACE VIEW market_outcomes_expanded AS
SELECT
  mo.condition_id_norm,
  idx - 1 AS outcome_idx,
  upperUTF8(toString(mo.outcomes[idx])) AS outcome_label
FROM market_outcomes mo
ARRAY JOIN arrayEnumerate(mo.outcomes) AS idx`;

  // C) Normalize resolutions
  const createResolutionsNorm = `CREATE OR REPLACE VIEW resolutions_norm AS
SELECT
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  upperUTF8(toString(winning_outcome)) AS win_label,
  resolved_at
FROM market_resolutions
WHERE winning_outcome IS NOT NULL`;

  // D) Map winning label to winning index
  const createWinningIndex = `CREATE OR REPLACE VIEW winning_index AS
SELECT
  r.condition_id_norm,
  anyIf(moe.outcome_idx, moe.outcome_label = r.win_label) AS win_idx,
  any(r.resolved_at) AS resolved_at
FROM resolutions_norm r
LEFT JOIN market_outcomes_expanded moe USING (condition_id_norm)
GROUP BY r.condition_id_norm`;

  // E) Compute per-trade cashflow and delta (using Float64 to avoid overflow)
  const createTradeFlows = `CREATE OR REPLACE VIEW trade_flows_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  cast(outcome_index as Int16) AS trade_idx,
  toString(outcome) AS outcome_raw,
  round(cast(entry_price as Float64) * cast(shares as Float64) *
    if(lowerUTF8(toString(side))='BUY', -1, 1), 8) AS cashflow_usdc,
  if(lowerUTF8(toString(side))='BUY',
    cast(shares as Float64),
    -cast(shares as Float64)) AS delta_shares
FROM trades_raw
WHERE market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000')`;

  // F) Realized PnL by market (fixed settlement: aggregate to market position first)
  const createRealizedPnL = `CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  any(resolved_at) AS resolved_at,
  round(sum(total_cashflow) + sum(winning_shares), 8) AS realized_pnl_usd,
  sum(fill_count) AS fill_count
FROM (
  SELECT
    tf.wallet,
    tf.market_id,
    cc.condition_id_norm,
    wi.resolved_at,
    tf.cashflow_usdc AS total_cashflow,
    if(coalesce(tf.trade_idx, multiIf(upperUTF8(tf.outcome_raw)='YES', 1, upperUTF8(tf.outcome_raw)='NO', 0, NULL)) = wi.win_idx,
       tf.delta_shares,
       0) AS winning_shares,
    1 AS fill_count
  FROM trade_flows_v2 tf
  JOIN canonical_condition cc ON cc.market_id = tf.market_id
  LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
  WHERE wi.win_idx IS NOT NULL
    AND coalesce(tf.trade_idx, multiIf(upperUTF8(tf.outcome_raw)='YES', 1, upperUTF8(tf.outcome_raw)='NO', 0, NULL)) IS NOT NULL
)
GROUP BY wallet, market_id, condition_id_norm`;

  // G) Summary views
  const createRealizedSummary = `CREATE OR REPLACE VIEW wallet_realized_pnl_v2 AS
SELECT wallet, round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_v2
GROUP BY wallet`;

  const createUnrealizedSummary = `CREATE OR REPLACE VIEW wallet_unrealized_pnl_v2 AS
SELECT wallet, round(sum(unrealized_pnl_usd), 2) AS unrealized_pnl_usd
FROM portfolio_mtm_detailed
GROUP BY wallet`;

  const createTotalSummary = `CREATE OR REPLACE VIEW wallet_pnl_summary_v2 AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(coalesce(r.realized_pnl_usd,0)+coalesce(u.unrealized_pnl_usd,0), 2) AS total_pnl_usd
FROM wallet_realized_pnl_v2 r
FULL JOIN wallet_unrealized_pnl_v2 u USING (wallet)`;

  // Execute all view creations
  const views = [
    ["Canonical Condition Bridge", createCanonicalBridge],
    ["Market Outcomes Expanded", createOutcomesExpanded],
    ["Resolutions Normalized", createResolutionsNorm],
    ["Winning Index", createWinningIndex],
    ["Trade Flows v2", createTradeFlows],
    ["Realized PnL by Market v2", createRealizedPnL],
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

  // Probe 1: Bridge coverage
  try {
    console.log("🔍 PROBE 1: Market Coverage\n");

    const bridgeProbe = await queryData(`
WITH m AS (
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
  countIf(wi.win_idx IS NOT NULL) AS resolvable
FROM m
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm`);

    if (bridgeProbe.length > 0) {
      const probe = bridgeProbe[0];
      console.log(`Markets touched: ${probe.markets_touched}`);
      console.log(`Bridged: ${probe.bridged}`);
      console.log(`Resolvable: ${probe.resolvable}`);
      if (probe.resolvable > 0) {
        console.log(`✅ Coverage OK\n`);
      } else {
        console.log(`⚠️ WARNING: No resolvable markets\n`);
      }
    }
  } catch (e: any) {
    console.error(`Probe 1 failed: ${e.message?.substring(0, 100)}\n`);
  }

  // Probe 2: Final P&L summary
  try {
    console.log("📊 PROBE 2: Wallet P&L Summary\n");

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
      console.log("HolyMoses7 (0xa4b3...):");
      const holy = finalResults.find((r: any) => r.wallet?.startsWith('0xa4b3'));
      if (holy) {
        console.log(`  Realized PnL:   $${holy.realized_pnl_usd}`);
        console.log(`  Unrealized PnL: $${holy.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:      $${holy.total_pnl_usd}`);
        console.log(`  Expected:       +$89,975 to +$91,633`);
        const variance = Math.abs(holy.total_pnl_usd - 90804) / 90804 * 100;
        console.log(`  Variance:       ${variance.toFixed(1)}%`);
        console.log();
      }

      console.log("niggemon (0xeb6f...):");
      const niggemon = finalResults.find((r: any) => r.wallet?.startsWith('0xeb6f'));
      if (niggemon) {
        console.log(`  Realized PnL:   $${niggemon.realized_pnl_usd}`);
        console.log(`  Unrealized PnL: $${niggemon.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:      $${niggemon.total_pnl_usd}`);
        console.log(`  Expected:       +$102,001`);
        const variance = Math.abs(niggemon.total_pnl_usd - 102001) / 102001 * 100;
        console.log(`  Variance:       ${variance.toFixed(1)}%`);
        console.log();
      }
    } else {
      console.log("⚠️ No results found\n");
    }
  } catch (e: any) {
    console.error(`Probe 2 failed: ${e.message?.substring(0, 150)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ Realized P&L Calculation Complete!\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
