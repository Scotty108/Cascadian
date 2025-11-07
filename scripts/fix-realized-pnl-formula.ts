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
    console.error(`❌ ${name}: ${e.message?.substring(0, 200)}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("CORRECT REALIZED PnL FORMULA");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Correct formula:
  // PnL = (winning shares won) * $1 - (total amount spent on all outcomes)
  // = sumIf(net_shares, outcome_idx = win_idx) - sum(cashflow_usdc)
  // where cashflow_usdc is positive for money out, negative for money in

  const fixView = `CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx, resolved_at FROM winning_index
)
SELECT
  p.wallet,
  p.market_id,
  p.condition_id_norm,
  w.resolved_at,
  round(
    sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)
    - sum(toFloat64(c.cashflow_usdc))
  , 4) AS realized_pnl_usd
FROM outcome_positions_v2 p
ANY LEFT JOIN trade_cashflows_v3 c
  ON c.wallet = p.wallet
 AND c.market_id = p.market_id
 AND c.condition_id_norm = p.condition_id_norm
ANY LEFT JOIN win w
  ON lower(replaceAll(w.condition_id_norm,'0x','')) = lower(replaceAll(p.condition_id_norm,'0x',''))
WHERE w.win_idx IS NOT NULL
GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at`;

  if (await executeQuery("Recreate realized_pnl_by_market_final (corrected formula)", fixView)) {
    // Test the new view
    console.log("\n📊 Test corrected realized PnL calculation:\n");
    const result = await ch.query({
      query: `
        SELECT
          p_wallet AS wallet,
          round(sum(realized_pnl_usd),2) AS total_realized
        FROM (
          SELECT 
            wallet AS p_wallet,
            realized_pnl_usd
          FROM realized_pnl_by_market_final
          WHERE wallet IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        )
        GROUP BY p_wallet
        ORDER BY p_wallet
      `,
      format: 'JSON'
    });
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
