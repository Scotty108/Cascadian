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
  console.log("IMPLEMENT CORRECT SETTLEMENT FORMULA (LONG WINNERS + SHORT LOSERS)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Step 1: Net position and signed cashflows per wallet/market/outcome_index
  const outcomePositionsV3 = `CREATE OR REPLACE VIEW outcome_positions_v3 AS
SELECT
  wallet_address AS wallet,
  market_id,
  condition_id AS condition_id_0x,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt32(toInt32OrNull(outcome_index)) AS idx,
  /* Signed cashflow: BUY/YES = negative (money out), SELL/NO = positive (money in) */
  sum(
    toFloat64(entry_price) * toFloat64(shares) *
    CASE
      WHEN side IN ('YES','BUY','Buy','buy','1') THEN -1
      ELSE  1
    END
  ) AS cashflow_usd,
  sumIf(toFloat64(shares), side IN ('YES','BUY','Buy','buy','1'))
    - sumIf(toFloat64(shares), side NOT IN ('YES','BUY','Buy','buy','1')) AS net_shares
FROM trades_dedup_mat
WHERE outcome_index IS NOT NULL
GROUP BY wallet, market_id, idx, condition_id_0x`;

  // Step 2: Combine positions with market conditions and winning outcomes
  const realizedInputsV1 = `CREATE OR REPLACE VIEW realized_inputs_v1 AS
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
ANY LEFT JOIN winners w USING (condition_id_norm)
WHERE w.winning_outcome IS NOT NULL`;

  // Step 3: Correct realized PnL per market
  const realizedPnLV3 = `CREATE OR REPLACE VIEW realized_pnl_by_market_v3 AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  sumIf(greatest(net_shares, 0), idx = winning_outcome) AS winning_longs,
  sumIf(greatest(-net_shares, 0), idx != winning_outcome) AS loser_shorts,
  round((winning_longs + loser_shorts), 4) AS settlement_usd,
  round(sum(cashflow_usd), 4) AS cashflow_total,
  round((settlement_usd + cashflow_total), 4) AS realized_pnl_usd
FROM realized_inputs_v1
GROUP BY wallet, market_id, condition_id_norm`;

  // Step 4: Wallet totals
  const walletRealizedPnLV3 = `CREATE OR REPLACE VIEW wallet_realized_pnl_v3 AS
SELECT wallet, round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_v3
GROUP BY wallet`;

  // Execute all views
  const views = [
    ["outcome_positions_v3 (signed cashflows)", outcomePositionsV3],
    ["realized_inputs_v1 (combine with winners)", realizedInputsV1],
    ["realized_pnl_by_market_v3 (correct settlement)", realizedPnLV3],
    ["wallet_realized_pnl_v3 (wallet totals)", walletRealizedPnLV3]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n✅ Views created: ${successCount}/${views.length}\n`);

  // Run sanity checks
  console.log("📊 SANITY CHECKS:\n");

  // A) Check for fanout
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
    console.log(`A) Fanout check: ${data.total_rows} rows, ${data.unique_positions} unique positions`);
    if (data.total_rows === data.unique_positions) {
      console.log(`   ✅ PASS: No fanout\n`);
    } else {
      console.log(`   ⚠️  WARNING: Fanout detected (${data.total_rows - data.unique_positions} extra rows)\n`);
    }
  } catch (e: any) {
    console.error(`❌ Fanout check failed: ${e.message?.substring(0, 100)}\n`);
  }

  // B) Check for missing winners
  try {
    const missing = await ch.query({
      query: `
        SELECT countIf(winning_outcome IS NULL) AS missing_winner_count
        FROM realized_inputs_v1
      `,
      format: 'JSON'
    });
    const text = await missing.text();
    const data = JSON.parse(text).data[0];
    if (data.missing_winner_count === 0) {
      console.log(`B) Missing winners: 0 ✅ PASS\n`);
    } else {
      console.log(`B) Missing winners: ${data.missing_winner_count} ⚠️  WARNING\n`);
    }
  } catch (e: any) {
    console.error(`❌ Missing winner check failed: ${e.message?.substring(0, 100)}\n`);
  }

  // C) Show final PnL for the two wallets
  console.log(`C) Final P&L with corrected settlement:\n`);
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
      console.log(`   ${row.wallet.substring(0, 10)}...: $${row.realized_pnl_usd}`);
    }
  } catch (e: any) {
    console.error(`❌ Final PnL check failed: ${e.message?.substring(0, 100)}`);
  }
}

main().catch(console.error);
