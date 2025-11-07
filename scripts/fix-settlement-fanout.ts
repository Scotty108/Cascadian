#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
});

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await ch.query({ query });
    console.log(`✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message?.substring(0, 300)}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("FIX SETTLEMENT FORMULA - PREVENT FANOUT WITH ANY JOINS");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Fixed version using ANY LEFT JOIN to prevent fanout
  const realizedInputsV1Fixed = `CREATE OR REPLACE VIEW realized_inputs_v1 AS
WITH positions AS (
  SELECT * FROM outcome_positions_v3
),
winners AS (
  SELECT condition_id_norm, toInt32(win_idx) AS winning_outcome
  FROM winning_index
)
SELECT
  p.wallet,
  p.market_id,
  p.condition_id_norm,
  p.idx,
  p.net_shares,
  p.cashflow_usd,
  w.winning_outcome
FROM positions p
ANY LEFT JOIN winners w USING (condition_id_norm)`;

  // Also fixed realized_pnl_by_market_v3 - just use market_id without condition_id
  const realizedPnLV3Fixed = `CREATE OR REPLACE VIEW realized_pnl_by_market_v3 AS
SELECT
  wallet,
  market_id,
  sumIf(greatest(net_shares, 0), idx = winning_outcome) AS winning_longs,
  sumIf(greatest(-net_shares, 0), idx != winning_outcome) AS loser_shorts,
  round((winning_longs + loser_shorts), 4) AS settlement_usd,
  round(sum(cashflow_usd), 4) AS cashflow_total,
  round((settlement_usd + cashflow_total), 4) AS realized_pnl_usd
FROM realized_inputs_v1
GROUP BY wallet, market_id`;

  const walletRealizedPnLV3Fixed = `CREATE OR REPLACE VIEW wallet_realized_pnl_v3 AS
SELECT wallet, round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_v3
GROUP BY wallet`;

  const views = [
    ["Fix realized_inputs_v1", realizedInputsV1Fixed],
    ["Fix realized_pnl_by_market_v3", realizedPnLV3Fixed],
    ["Fix wallet_realized_pnl_v3", walletRealizedPnLV3Fixed]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n✅ Views fixed: ${successCount}/${views.length}\n`);

  // Run sanity checks again
  console.log("📊 SANITY CHECKS (AFTER FIX):\n");

  try {
    const fanout = await ch.query({
      query: `
        SELECT
          count() AS total_rows,
          count(DISTINCT tuple(wallet, market_id, idx)) AS unique_positions
        FROM realized_inputs_v1
      `,
      format: 'JSON'
    });
    const text = await fanout.text();
    const data = JSON.parse(text).data[0];
    console.log(`A) Fanout check: ${data.total_rows} rows, ${data.unique_positions} unique`);
    if (data.total_rows === data.unique_positions) {
      console.log(`   ✅ PASS: No fanout\n`);
    } else {
      console.log(`   ⚠️  Fanout: ${data.total_rows - data.unique_positions} extra rows\n`);
    }
  } catch (e: any) {
    console.error(`❌ Check failed: ${e.message?.substring(0, 100)}\n`);
  }

  console.log(`B) Final P&L with corrected settlement:\n`);
  try {
    const finalPnL = await ch.query({
      query: `
        SELECT wallet, realized_pnl_usd
        FROM wallet_realized_pnl_v3
        WHERE wallet IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        ORDER BY wallet
      `,
      format: 'JSON'
    });
    const text = await finalPnL.text();
    const data = JSON.parse(text).data;
    for (const row of data) {
      const expected = row.wallet === '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8' ? 89975.16 : 102001.46;
      const variance = Math.abs(row.realized_pnl_usd - expected) / expected * 100;
      console.log(`   ${row.wallet.substring(0, 10)}...`);
      console.log(`     Calculated: $${row.realized_pnl_usd}`);
      console.log(`     Expected:   $${expected}`);
      console.log(`     Variance:   ${variance.toFixed(2)}%`);
      console.log(`     Status:     ${variance <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
    }
  } catch (e: any) {
    console.error(`❌ Final PnL check failed: ${e.message?.substring(0, 100)}`);
  }
}

main().catch(console.error);
