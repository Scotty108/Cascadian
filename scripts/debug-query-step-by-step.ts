#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryData(query: string, name: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    console.log(`\n[${name}]`);
    console.log(`  Rows returned: ${data.length}`);
    if (data.length > 0) {
      console.log(`  Sample:`, JSON.stringify(data.slice(0, 2)));
    }
    return data;
  } catch (e: any) {
    console.error(`  ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  console.log("🔍 STEP-BY-STEP QUERY DEBUG FOR NIGGEMON\n");
  
  // Test each component
  await queryData(`SELECT COUNT(*) FROM outcome_positions_v2 WHERE wallet = lower('${wallet}')`, "Niggemon in outcome_positions");
  
  await queryData(`SELECT COUNT(*) FROM trade_cashflows_v3 WHERE wallet = lower('${wallet}')`, "Niggemon in trade_cashflows");
  
  await queryData(`SELECT COUNT(*) FROM wallet_unrealized_pnl_v2 WHERE wallet = lower('${wallet}')`, "Niggemon in wallet_unrealized");
  
  // Test the winning_index join separately
  await queryData(`
    SELECT COUNT(*) FROM outcome_positions_v2 p
    LEFT JOIN winning_index w ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet = lower('${wallet}')
  `, "JoinedCheck: outcome_positions joined to winning_index");
  
  // Test the full validation query but WITHOUT grouping to see all rows
  await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
    )
    SELECT
      p.wallet,
      p.condition_id_norm,
      COUNT(*) as row_count,
      SUM(c.cashflow_usdc) as total_cashflow,
      SUM(IF(p.outcome_idx = w.win_idx, p.net_shares, 0)) as winning_shares
    FROM outcome_positions_v2 AS p
    LEFT JOIN trade_cashflows_v3 AS c
      ON c.wallet = p.wallet AND c.condition_id_norm = p.condition_id_norm
    LEFT JOIN win AS w
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet = lower('${wallet}')
    GROUP BY p.wallet, p.condition_id_norm
    LIMIT 10
  `, "FullQuery breakdown (first 10 conditions)");
}

main();
