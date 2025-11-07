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
  
  // UI targets (all-time realized PnL, net of fees)
  const ui_targets = {
    [wallet1.toLowerCase()]: 89975.16,
    [wallet2.toLowerCase()]: 102001.46
  };

  console.log("\n════════════════════════════════════════════════════════════════════════════════");
  console.log("STEP 7: TWO-WALLET RECONCILIATION");
  console.log("════════════════════════════════════════════════════════════════════════════════\n");

  console.log("TARGET WALLETS:");
  console.log(`  HolyMoses7:  ${wallet1}`);
  console.log(`  niggemon:    ${wallet2}\n`);

  console.log("UI TARGETS (realized-only, net of fees):");
  console.log(`  HolyMoses7:  $${ui_targets[wallet1.toLowerCase()].toFixed(2)}`);
  console.log(`  niggemon:    $${ui_targets[wallet2.toLowerCase()].toFixed(2)}\n`);

  console.log("QUERYING CURATED CHAIN FOR P&L:\n");

  const query = `
    SELECT 
      wallet,
      realized_pnl_usd,
      unrealized_pnl_usd,
      total_pnl_usd
    FROM wallet_pnl_summary_final
    WHERE wallet IN (
      lower('${wallet1}'),
      lower('${wallet2}')
    )
    ORDER BY wallet
  `;

  const results = await queryData(query);
  
  if (!results) {
    console.log("❌ ERROR: Query failed\n");
    process.exit(1);
  }

  if (results.length === 0) {
    console.log("⚠️  No results found. The views may not have data.\n");
    process.exit(1);
  }

  console.log("RESULTS FROM CURATED CHAIN:");
  console.log("─".repeat(90));
  console.log(`  {"Wallet":<12} | {"Realized":<12} | {"Unrealized":<12} | {"Total":<12} | {"Variance %":<10}`);
  console.log("─".repeat(90));

  let all_pass = true;
  for (const row of results) {
    const wallet = row[0];
    const realized = parseFloat(row[1]);
    const unrealized = parseFloat(row[2]);
    const total = parseFloat(row[3]);

    const ui_target = ui_targets[wallet.toLowerCase()];
    const variance_pct = ui_target > 0 ? ((realized - ui_target) / ui_target * 100) : 0;
    
    const status = Math.abs(variance_pct) <= 5 ? "✅" : "❌";
    const w = wallet.substring(0, 12);
    
    console.log(
      `  ${w}... | $${realized.toFixed(2).padStart(10)} | $${unrealized.toFixed(2).padStart(10)} | $${total.toFixed(2).padStart(10)} | ${variance_pct.toFixed(1).padStart(8)}% ${status}`
    );

    if (Math.abs(variance_pct) > 5) {
      all_pass = false;
    }
  }

  console.log("─".repeat(90) + "\n");

  if (all_pass) {
    console.log("════════════════════════════════════════════════════════════════════════════════");
    console.log("✅ SUCCESS: Both wallets within ±5% tolerance!");
    console.log("════════════════════════════════════════════════════════════════════════════════\n");
  } else {
    console.log("════════════════════════════════════════════════════════════════════════════════");
    console.log("⚠️  VARIANCE EXCEEDS 5% - Running diagnostic probes...");
    console.log("════════════════════════════════════════════════════════════════════════════════\n");
  }
}

main().catch(console.error);
