#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("DIRECT P&L CALCULATION: Minimal approach");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  // Step 1: Try direct cashflow calculation from trades_raw (without settlement)
  console.log("APPROACH A: Total Cashflows only (no settlement)");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          lower(wallet_address) as wallet,
          count() as trade_count,
          sum(
            CAST(entry_price AS Float64) * CAST(shares AS Float64) * 
            (CASE WHEN lower(toString(side)) = 'buy' THEN -1 ELSE 1 END)
          ) as total_cashflows
        FROM trades_raw
        WHERE lower(wallet_address) IN (lower('${niggemon}'), lower('${holymoses}'))
          AND market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000')
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0];
      const count = row[1];
      const cashflows = parseFloat(row[2] || "0");
      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Trades: ${count}`);
      console.log(`    Cashflows: $${cashflows.toFixed(2)}\n`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 2: Try filtering to resolved markets only
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("APPROACH B: Cashflows for trades in RESOLVED markets only");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          lower(t.wallet_address) as wallet,
          count() as resolved_trades,
          sum(
            CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64) * 
            (CASE WHEN lower(toString(t.side)) = 'buy' THEN -1 ELSE 1 END)
          ) as pnl_resolved
        FROM trades_raw t
        INNER JOIN winning_index w ON lower(replaceAll(
          COALESCE(cm.condition_id, ctf.condition_id, ''), '0x', ''
        )) = w.condition_id_norm
        LEFT JOIN condition_market_map cm ON lower(t.market_id) = lower(cm.market_id)
        LEFT JOIN ctf_token_map ctf ON lower(t.market_id) = lower(ctf.market_id)
        WHERE lower(t.wallet_address) IN (lower('${niggemon}'), lower('${holymoses}'))
          AND t.market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000')
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0];
      const count = row[1];
      const pnl = parseFloat(row[2] || "0");
      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Resolved trades: ${count}`);
      console.log(`    P&L: $${pnl.toFixed(2)}\n`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 3: Check trade_cashflows_v3 directly
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("APPROACH C: Using trade_cashflows_v3 (resolved trades only)");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          count() as resolved_trades,
          sum(CAST(cashflow_usdc AS Float64)) as pnl
        FROM trade_cashflows_v3
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0];
      const count = row[1];
      const pnl = parseFloat(row[2] || "0");
      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Resolved trades: ${count}`);
      console.log(`    P&L: $${pnl.toFixed(2)}\n`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 4: Expected values
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("EXPECTED VALUES");
  console.log("─".repeat(70));
  console.log("niggemon:    $102,001.46");
  console.log("HolyMoses7:  $89,975.16\n");
}

main().catch(console.error);
