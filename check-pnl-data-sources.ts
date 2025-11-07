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
  console.log("\n📋 CHECKING DATA SOURCES FOR P&L CALCULATION\n");

  try {
    // Check trades_raw columns
    console.log("trades_raw columns:");
    const tradesSchema = await ch.query({
      query: "DESC trades_raw",
      format: "JSONCompact"
    });
    
    const tradesText = await tradesSchema.text();
    const tradesData = JSON.parse(tradesText).data || [];
    
    const keyTradesCols = [
      "wallet_address", "condition_id_norm", "tx_hash", "side",
      "amount_usdc", "tokens_in", "tokens_out", "tx_price",
      "timestamp", "resolved", "winning_outcome"
    ];
    
    for (const col of keyTradesCols) {
      const found = tradesData.find(row => row[0] === col);
      if (found) {
        console.log(`  ✓ ${col}: ${found[1]}`);
      } else {
        console.log(`  ✗ ${col}: NOT FOUND`);
      }
    }

    // Check market_resolutions_final columns
    console.log("\nmarket_resolutions_final columns:");
    const resSchema = await ch.query({
      query: "DESC market_resolutions_final",
      format: "JSONCompact"
    });
    
    const resText = await resSchema.text();
    const resData = JSON.parse(resText).data || [];
    
    const keyResCols = [
      "condition_id_norm", "winning_index", "winning_outcome",
      "payout_numerators", "payout_denominator", "resolved_at"
    ];
    
    for (const col of keyResCols) {
      const found = resData.find(row => row[0] === col);
      if (found) {
        console.log(`  ✓ ${col}: ${found[1]}`);
      } else {
        console.log(`  ✗ ${col}: NOT FOUND`);
      }
    }

    // Check sample trade data
    console.log("\nSample trades_raw data:");
    const sample = await ch.query({
      query: `
        SELECT 
          wallet_address, 
          condition_id_norm, 
          side, 
          amount_usdc, 
          tx_price,
          resolved,
          winning_outcome
        FROM trades_raw
        WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        LIMIT 3
      `,
      format: "JSONCompact"
    });
    
    const sampleText = await sample.text();
    const sampleData = JSON.parse(sampleText).data || [];
    
    for (const row of sampleData) {
      console.log(`  wallet=${row[0].substring(0,10)}..., cid=${row[1].substring(0,20)}..., side=${row[2]}, usdc=${row[3]}, price=${row[4]}, resolved=${row[5]}, winner=${row[6]}`);
    }

    // Check if trades_raw has resolved status
    console.log("\nResolution coverage in trades_raw:");
    const coverage = await ch.query({
      query: `
        SELECT 
          countIf(resolved = 1) as resolved_trades,
          count() as total_trades,
          round(countIf(resolved = 1) * 100.0 / count(), 1) as coverage_pct
        FROM trades_raw
        WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });
    
    const covText = await coverage.text();
    const covData = JSON.parse(covText).data || [];
    console.log(`  Niggemon: ${covData[0][0]} resolved / ${covData[0][1]} total (${covData[0][2]}% coverage)`);

  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
