#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("\n🔍 DEBUGGING: What trades_raw actually contains for niggemon\n");

  const result = await ch.query({
    query: `
      SELECT
        trade_id,
        market_id,
        side,
        entry_price,
        exit_price,
        shares,
        was_win,
        pnl,
        outcome_index,
        condition_id
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
      LIMIT 10
    `,
    format: "JSONCompact"
  });

  const text = await result.text();
  const data = JSON.parse(text).data;

  console.log("Sample of 10 trades from trades_raw:");
  console.log("─".repeat(120));
  console.log("Side  | Entry Price | Exit Price | Shares  | Was_Win | PnL     | Outcome Idx");
  console.log("─".repeat(120));

  for (const row of data) {
    const [tid, mid, side, ep, xp, sh, ww, pnl, oi, cid] = row;
    const epStr = ep ? ep.toString().substring(0, 8) : "NULL";
    const xpStr = xp ? xp.toString().substring(0, 8) : "NULL";
    const shStr = sh.toString().substring(0, 8);
    const wwStr = ww !== null ? ww.toString() : "NULL";
    const pnlStr = pnl !== null ? pnl.toString().substring(0, 8) : "NULL";

    console.log(`${side.padEnd(4)} | ${epStr.padEnd(11)} | ${xpStr.padEnd(10)} | ${shStr.padEnd(7)} | ${wwStr.padEnd(7)} | ${pnlStr.padEnd(7)} | ${oi.toString().padEnd(11)}`);
  }

  console.log("\n✅ What we're looking for:");
  console.log("  - entry_price: should be populated for all");
  console.log("  - exit_price: should be populated for SELL trades");
  console.log("  - was_win: should indicate 1=win or 0=loss for resolved");
  console.log("  - pnl: should match our calculation");
}

main().catch(console.error);
