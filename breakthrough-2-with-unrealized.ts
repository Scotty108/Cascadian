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
  console.log("BREAKTHROUGH #2: REALIZED + UNREALIZED (Combined Total)");
  console.log("════════════════════════════════════════════════════════════════\n");

  console.log("HYPOTHESIS: UI targets include BOTH realized + unrealized P&L\n");

  // Get realized from curated chain
  console.log("1. REALIZED PNL (from curated chain)");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT 
      wallet,
      realized_pnl_usd
    FROM wallet_realized_pnl_final
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    ORDER BY wallet
  `);

  const realized = {};
  if (result && result.length > 0) {
    for (const r of result) {
      const w = r[0];
      const pnl = parseFloat(r[1]);
      realized[w] = pnl;
      console.log(`  ${w.substring(0, 12)}... : $${pnl.toFixed(2)}`);
    }
  }
  console.log("");

  // Get unrealized
  console.log("2. UNREALIZED PNL (from wallet_unrealized_pnl_v2)");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      wallet,
      unrealized_pnl_usd
    FROM wallet_unrealized_pnl_v2
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    ORDER BY wallet
  `);

  const unrealized = {};
  if (result && result.length > 0) {
    for (const r of result) {
      const w = r[0];
      const pnl = parseFloat(r[1]);
      unrealized[w] = pnl;
      console.log(`  ${w.substring(0, 12)}... : $${pnl.toFixed(2)}`);
    }
  }
  console.log("");

  // Combined
  console.log("3. COMBINED (Realized + Unrealized)");
  console.log("─".repeat(70));
  
  const combined = {};
  for (const w of Object.keys(realized)) {
    const r = realized[w] || 0;
    const u = unrealized[w] || 0;
    const total = r + u;
    combined[w] = total;
    console.log(`  ${w.substring(0, 12)}... : $${r.toFixed(2)} + $${u.toFixed(2)} = $${total.toFixed(2)}`);
  }
  console.log("");

  // Compare to UI targets
  console.log("4. VARIANCE ANALYSIS");
  console.log("─".repeat(70));

  const ui_targets = {
    [wallet1.toLowerCase()]: 89975.16,
    [wallet2.toLowerCase()]: 102001.46
  };

  console.log(`  Wallet       | Combined | UI Target | Variance | Match?`);
  console.log(`  ${"─".repeat(60)}`);

  for (const w of Object.keys(combined)) {
    const c = combined[w];
    const target = ui_targets[w];
    const variance = ((c - target) / target * 100).toFixed(1);
    const match = Math.abs(c - target) <= target * 0.05 ? "✅" : "❌";
    console.log(`  ${w.substring(0, 12)}... | $${c.toFixed(2).padStart(10)} | $${target.toFixed(2).padStart(10)} | ${variance.padStart(6)}% | ${match}`);
  }
  console.log("");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
