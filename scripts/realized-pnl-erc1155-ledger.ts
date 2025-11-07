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
  console.log("REALIZED P&L - ERC-1155 LEDGER APPROACH");
  console.log("Using ERC-1155 deltas as source of truth for positions");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Step 2: Build ERC-1155 token dimension
  const createTokenDim = `CREATE OR REPLACE VIEW token_dim AS
SELECT
  lower(toString(token_id)) AS token_id,
  lower(replaceAll(condition_id_norm,'0x','')) AS condition_id_norm,
  cast(outcome_index as Int16) AS outcome_idx,
  lower(market_id) AS market_id
FROM ctf_token_map
WHERE market_id NOT IN ('12')`;

  // ERC-1155 ledger aggregated per outcome (wallet receives = positive, sends = negative)
  const createERC1155Ledger = `CREATE OR REPLACE VIEW erc1155_ledger AS
WITH normalized AS (
  SELECT
    lower(toString(f.to_address)) AS wallet,
    lower(toString(f.token_id)) AS token_id,
    cast(f.amount as Float64) AS amount_delta
  FROM pm_erc1155_flats f
  WHERE lower(toString(f.to_address)) != '0x0000000000000000000000000000000000000000'

  UNION ALL

  SELECT
    lower(toString(f.from_address)) AS wallet,
    lower(toString(f.token_id)) AS token_id,
    -cast(f.amount as Float64) AS amount_delta
  FROM pm_erc1155_flats f
  WHERE lower(toString(f.from_address)) != '0x0000000000000000000000000000000000000000'
)
SELECT
  n.wallet,
  td.market_id,
  td.condition_id_norm,
  td.outcome_idx,
  round(sum(n.amount_delta), 8) AS shares_delta
FROM normalized n
JOIN token_dim td ON td.token_id = n.token_id
GROUP BY n.wallet, td.market_id, td.condition_id_norm, td.outcome_idx`;

  // Trade cashflows per outcome using ERC-1155 sign direction
  const createTradeCashflows = `CREATE OR REPLACE VIEW trade_cashflows AS
WITH t AS (
  SELECT
    lower(toString(tr.wallet_address)) AS wallet,
    lower(toString(tr.market_id)) AS market_id,
    lower(replaceAll(toString(tr.condition_id),'0x','')) AS condition_id_norm,
    cast(toInt16OrNull(tr.outcome_index) as Int16) AS outcome_idx,
    cast(tr.entry_price as Float64) AS px,
    cast(tr.shares as Float64) AS sh,
    lower(toString(tr.transaction_hash)) AS tx,
    cast(toInt32OrNull(tr.log_index) as Int32) AS li
  FROM trades_raw tr
  WHERE market_id NOT IN ('12')
),
j AS (
  SELECT
    t.wallet,
    t.market_id,
    t.condition_id_norm,
    t.outcome_idx,
    round(
      sum(
        if(f.amount_delta >= 0,
          -cast(t.px as Float64) * abs(cast(t.sh as Float64)),
          cast(t.px as Float64) * abs(cast(t.sh as Float64))
        )
      ), 8
    ) AS cashflow_usdc
  FROM t
  LEFT JOIN pm_erc1155_flats f
    ON lower(toString(f.tx_hash)) = t.tx
   AND cast(toInt32OrNull(f.log_index) as Int32) = t.li
  GROUP BY t.wallet, t.market_id, t.condition_id_norm, t.outcome_idx
)
SELECT
  wallet,
  market_id,
  condition_id_norm,
  outcome_idx,
  coalesce(cashflow_usdc, 0) AS cashflow_usdc
FROM j`;

  // Net positions per outcome
  const createOutcomePositions = `CREATE OR REPLACE VIEW outcome_positions AS
SELECT
  l.wallet,
  l.market_id,
  l.condition_id_norm,
  l.outcome_idx,
  round(sum(l.shares_delta), 8) AS net_shares
FROM erc1155_ledger l
GROUP BY l.wallet, l.market_id, l.condition_id_norm, l.outcome_idx`;

  // Realized PnL per market
  const createRealizedPnL = `CREATE OR REPLACE VIEW realized_pnl_by_market AS
WITH pos AS (
  SELECT
    p.wallet,
    p.market_id,
    p.condition_id_norm,
    p.outcome_idx,
    cast(p.net_shares as Float64) AS net_shares
  FROM outcome_positions p
),
cf AS (
  SELECT
    c.wallet,
    c.market_id,
    c.condition_id_norm,
    c.outcome_idx,
    cast(c.cashflow_usdc as Float64) AS cashflow_usdc
  FROM trade_cashflows c
),
win AS (
  SELECT
    wi.condition_id_norm,
    wi.win_idx,
    wi.resolved_at
  FROM winning_index wi
)
SELECT
  pos.wallet,
  pos.market_id,
  pos.condition_id_norm,
  win.resolved_at,
  round(
    sum(-cf.cashflow_usdc) + sumIf(pos.net_shares, pos.outcome_idx = win.win_idx),
    4
  ) AS realized_pnl_usd,
  count() AS outcome_rows
FROM pos
LEFT JOIN cf USING (wallet, market_id, condition_id_norm, outcome_idx)
LEFT JOIN win USING (condition_id_norm)
WHERE win.win_idx IS NOT NULL
GROUP BY pos.wallet, pos.market_id, pos.condition_id_norm, win.resolved_at`;

  // Wallet summaries
  const createWalletRealizedPnL = `CREATE OR REPLACE VIEW wallet_realized_pnl AS
SELECT wallet, round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market
GROUP BY wallet`;

  const createWalletPnLSummary = `CREATE OR REPLACE VIEW wallet_pnl_summary AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(coalesce(r.realized_pnl_usd,0)+coalesce(u.unrealized_pnl_usd,0), 2) AS total_pnl_usd
FROM wallet_realized_pnl r
FULL JOIN wallet_unrealized_pnl u USING (wallet)`;

  // Execute all views
  const views = [
    ["Token Dimension", createTokenDim],
    ["ERC-1155 Ledger", createERC1155Ledger],
    ["Trade Cashflows", createTradeCashflows],
    ["Outcome Positions", createOutcomePositions],
    ["Realized PnL by Market", createRealizedPnL],
    ["Wallet Realized PnL", createWalletRealizedPnL],
    ["Wallet PnL Summary", createWalletPnLSummary]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`View Creation: ${successCount}/${views.length} successful\n`);

  // Probe 1: Coverage
  try {
    console.log("🔍 PROBE 1: Market Coverage\n");

    const coverageProbe = await queryData(`
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
LEFT JOIN winning_index wi USING (condition_id_norm)`);

    if (coverageProbe.length > 0) {
      const probe = coverageProbe[0];
      console.log(`Markets touched: ${probe.markets_touched}`);
      console.log(`Bridged: ${probe.bridged}`);
      console.log(`Resolvable: ${probe.resolvable}`);
      console.log();
    }
  } catch (e: any) {
    console.log(`Probe 1 skipped: ${e.message?.substring(0, 80)}\n`);
  }

  // Probe 2: Final numbers
  try {
    console.log("📊 PROBE 2: Wallet P&L Summary\n");

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
        console.log(`  Realized PnL:   $${holy.realized_pnl_usd}`);
        console.log(`  Unrealized PnL: $${holy.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:      $${holy.total_pnl_usd}`);
        console.log(`  Expected:       +$89,975 to +$91,633`);
        const match = Math.abs(holy.total_pnl_usd - 90804) / 90804 * 100; // avg expected
        console.log(`  Variance:       ${match.toFixed(1)}%`);
        console.log();
      }

      console.log("niggemon (0xeb6f...):");
      const niggemon = finalResults.find((r: any) => r.wallet?.startsWith('0xeb6f'));
      if (niggemon) {
        console.log(`  Realized PnL:   $${niggemon.realized_pnl_usd}`);
        console.log(`  Unrealized PnL: $${niggemon.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:      $${niggemon.total_pnl_usd}`);
        console.log(`  Expected:       +$102,001`);
        const match = Math.abs(niggemon.total_pnl_usd - 102001) / 102001 * 100;
        console.log(`  Variance:       ${match.toFixed(1)}%`);
        console.log();
      }
    }
  } catch (e: any) {
    console.error(`Probe 2 failed: ${e.message?.substring(0, 150)}\n`);
  }

  // If variance > 5%, show top 10 positions
  try {
    console.log("🔍 TOP 10 REALIZED P&L POSITIONS (by absolute value)\n");

    const topPositions = await queryData(`
SELECT
  wallet,
  market_id,
  realized_pnl_usd,
  outcome_rows
FROM realized_pnl_by_market
WHERE wallet IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
ORDER BY abs(realized_pnl_usd) DESC
LIMIT 10`);

    if (topPositions.length > 0) {
      topPositions.forEach((row: any, idx: number) => {
        const wallet = row.wallet?.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`${idx+1}. ${wallet} | ${row.market_id?.slice(0,16)}... | PnL: $${row.realized_pnl_usd}`);
      });
      console.log();
    }
  } catch (e: any) {
    console.log(`Top positions skipped: ${e.message?.substring(0, 80)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ ERC-1155 Ledger P&L Calculation Complete!\n");
  console.log("Views created (using canonical_condition, resolutions_norm, winning_index):");
  console.log("  - token_dim");
  console.log("  - erc1155_ledger (source of truth for positions)");
  console.log("  - trade_cashflows (cost basis)");
  console.log("  - outcome_positions (net shares per outcome)");
  console.log("  - realized_pnl_by_market (settlement logic)");
  console.log("  - wallet_realized_pnl");
  console.log("  - wallet_pnl_summary");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
