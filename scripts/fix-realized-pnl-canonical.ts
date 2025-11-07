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
  console.log("POLYMARKET REALIZED P&L - CANONICAL BRIDGE APPROACH");
  console.log("Building authoritative condition_id bridge with proper normalization");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // A) Build canonical bridge from two sources
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

  // E) Compute per-trade cashflow
  const createTradeFlows = `CREATE OR REPLACE VIEW trade_flows AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  cast(outcome_index as Int16) AS trade_idx,
  toString(outcome) AS outcome_raw,
  round(cast(entry_price as Decimal64(8)) * cast(shares as Decimal64(8)) *
    if(lowerUTF8(toString(side))='BUY', -1, 1), 4) AS cashflow_usdc,
  if(lowerUTF8(toString(side))='BUY',
    cast(shares as Decimal64(8)),
    -cast(shares as Decimal64(8))) AS delta_shares
FROM trades_raw
WHERE market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000')`;

  // F) Realized PnL by market using index match
  const createRealizedPnL = `CREATE OR REPLACE VIEW realized_pnl_by_market AS
WITH j AS (
  SELECT
    tf.wallet,
    tf.market_id,
    cc.condition_id_norm,
    wi.win_idx,
    wi.resolved_at,
    coalesce(
      tf.trade_idx,
      multiIf(upperUTF8(tf.outcome_raw)='YES', 1,
              upperUTF8(tf.outcome_raw)='NO', 0,
              NULL)
    ) AS trade_idx,
    tf.cashflow_usdc,
    tf.delta_shares
  FROM trade_flows tf
  JOIN canonical_condition cc ON cc.market_id = tf.market_id
  LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
)
SELECT
  wallet,
  market_id,
  condition_id_norm,
  resolved_at,
  round(sum(cashflow_usdc) + sumIf(delta_shares, trade_idx = win_idx), 4) AS realized_pnl_usd,
  count() AS fills
FROM j
WHERE win_idx IS NOT NULL AND trade_idx IS NOT NULL
GROUP BY wallet, market_id, condition_id_norm, resolved_at`;

  // G) Summary views
  const createRealizedSummary = `CREATE OR REPLACE VIEW wallet_realized_pnl AS
SELECT wallet, round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market
GROUP BY wallet`;

  const createUnrealizedSummary = `CREATE OR REPLACE VIEW wallet_unrealized_pnl AS
SELECT wallet, round(sum(unrealized_pnl_usd), 2) AS unrealized_pnl_usd
FROM portfolio_mtm_detailed
GROUP BY wallet`;

  const createTotalSummary = `CREATE OR REPLACE VIEW wallet_pnl_summary AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(coalesce(r.realized_pnl_usd,0)+coalesce(u.unrealized_pnl_usd,0), 2) AS total_pnl_usd
FROM wallet_realized_pnl r
FULL JOIN wallet_unrealized_pnl u USING (wallet)`;

  // Execute all view creations
  const views = [
    ["Canonical Condition Bridge", createCanonicalBridge],
    ["Market Outcomes Expanded", createOutcomesExpanded],
    ["Resolutions Normalized", createResolutionsNorm],
    ["Winning Index", createWinningIndex],
    ["Trade Flows", createTradeFlows],
    ["Realized PnL by Market", createRealizedPnL],
    ["Wallet Realized PnL", createRealizedSummary],
    ["Wallet Unrealized PnL", createUnrealizedSummary],
    ["Wallet PnL Summary", createTotalSummary]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`View Creation: ${successCount}/${views.length} successful\n`);

  // H1) Sanity probe: Bridge coverage
  try {
    console.log("🔍 SANITY PROBE H1: Bridge Coverage for Target Wallets\n");

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
      console.log(`Bridged to condition_id: ${probe.bridged}`);
      console.log(`Resolvable (have winning outcome): ${probe.resolvable}`);
      if (probe.resolvable == 0) {
        console.log(`⚠️  WARNING: No resolvable markets! Need to investigate bridge.\n`);
      } else {
        console.log(`✅ Coverage looks good\n`);
      }
    }
  } catch (e: any) {
    console.error(`H1 failed: ${e.message?.substring(0, 100)}\n`);
  }

  // H2) Sanity probe: First 20 non-resolvable markets
  try {
    console.log("🔍 SANITY PROBE H2: First 20 Markets Without Winners\n");

    const unresolvedProbe = await queryData(`
SELECT
  m.market_id,
  cc.condition_id_norm,
  any(r.win_label) AS win_label,
  any(moe.outcome_label) AS any_label
FROM (
  SELECT DISTINCT lower(market_id) AS market_id
  FROM trades_raw
  WHERE lower(wallet_address) IN (
    '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  )
) m
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN resolutions_norm r ON r.condition_id_norm = cc.condition_id_norm
LEFT JOIN market_outcomes_expanded moe ON moe.condition_id_norm = cc.condition_id_norm
WHERE r.win_label IS NULL
LIMIT 20`);

    if (unresolvedProbe.length > 0) {
      console.log(`Found ${unresolvedProbe.length} non-resolvable markets (may be normal if partially resolved):`);
      unresolvedProbe.slice(0, 5).forEach((row: any, idx: number) => {
        console.log(`  ${idx+1}. market=${row.market_id?.slice(0,16)}... condition=${row.condition_id_norm?.slice(0,16)}...`);
      });
      console.log();
    } else {
      console.log(`✅ All markets appear resolvable\n`);
    }
  } catch (e: any) {
    console.error(`H2 failed: ${e.message?.substring(0, 100)}\n`);
  }

  // H3) Sanity probe: market_resolutions data
  try {
    console.log("🔍 SANITY PROBE H3: Market Resolutions Data\n");

    const resolutionsProbe = await queryData(`
SELECT
  count() AS rows,
  countIf(winning_outcome IS NOT NULL) AS with_winner
FROM market_resolutions`);

    if (resolutionsProbe.length > 0) {
      const probe = resolutionsProbe[0];
      console.log(`market_resolutions table:`);
      console.log(`  Total rows: ${probe.rows}`);
      console.log(`  Rows with winning_outcome: ${probe.with_winner}`);
      console.log();
    }
  } catch (e: any) {
    console.error(`H3 failed: ${e.message?.substring(0, 100)}\n`);
  }

  // Final results: Wallet PnL Summary
  try {
    console.log("📊 FINAL RESULTS: Wallet P&L Summary\n");

    const finalResults = await queryData(`
SELECT
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
ORDER BY wallet`);

    if (finalResults.length > 0) {
      console.log("HolyMoses7 (0xa4b3...):");
      const holy = finalResults.find((r: any) => r.wallet?.startsWith('0xa4b3'));
      if (holy) {
        console.log(`  Realized P&L:   $${holy.realized_pnl_usd}`);
        console.log(`  Unrealized P&L: $${holy.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:      $${holy.total_pnl_usd}`);
        console.log(`  Expected:       +$89,975 to +$91,633`);
        console.log();
      } else {
        console.log(`  ⚠️ No data found\n`);
      }

      console.log("niggemon (0xeb6f...):");
      const niggemon = finalResults.find((r: any) => r.wallet?.startsWith('0xeb6f'));
      if (niggemon) {
        console.log(`  Realized P&L:   $${niggemon.realized_pnl_usd}`);
        console.log(`  Unrealized P&L: $${niggemon.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:      $${niggemon.total_pnl_usd}`);
        console.log(`  Expected:       +$102,001`);
        console.log();
      } else {
        console.log(`  ⚠️ No data found\n`);
      }
    } else {
      console.log("⚠️ No results found in wallet_pnl_summary\n");
    }
  } catch (e: any) {
    console.error("❌ Failed to fetch final results:", e.message?.substring(0, 150));
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ Canonical Bridge P&L Calculation Complete!\n");
  console.log("Views created:");
  console.log("  A) canonical_condition");
  console.log("  B) market_outcomes_expanded");
  console.log("  C) resolutions_norm");
  console.log("  D) winning_index");
  console.log("  E) trade_flows");
  console.log("  F) realized_pnl_by_market");
  console.log("  G) wallet_realized_pnl, wallet_unrealized_pnl, wallet_pnl_summary");
  console.log("\nSanity probes: H1 (bridge coverage), H2 (non-resolvable), H3 (resolutions data)");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
