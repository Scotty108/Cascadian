#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 300000,
});

async function main() {
  console.log("\n📊 REBUILDING P&L WITH POLYMARKET FORMULA\n");
  console.log("Formula: Net P&L = Realized Gains - Realized Losses\n");

  try {
    console.log("Step 1: Analyzing trades_raw structure...");
    
    const schema = await ch.query({
      query: "DESC trades_raw LIMIT 20",
      format: "JSONCompact"
    });
    
    const schemaText = await schema.text();
    const schemaData = JSON.parse(schemaText).data || [];
    
    console.log("\nKey columns in trades_raw:");
    const keyColumns = [
      "wallet_address", "condition_id_norm", "amount_usdc", "tokens_in", 
      "tokens_out", "tx_price", "side", "resolved", "winning_outcome",
      "payout_numerators", "payout_denominator"
    ];
    
    for (const col of keyColumns) {
      const found = schemaData.find(row => row[0] === col);
      if (found) {
        console.log(`  ✓ ${col}: ${found[1]}`);
      }
    }
    
    console.log("\nStep 2: Creating wallet_pnl_correct table...");
    
    // Build P&L from trades:
    // For each trade: gain/loss = (exit_price - entry_price) * shares
    // For resolved positions: gain/loss = (payout - cost_basis)
    
    await ch.command({
      query: `
        CREATE TABLE wallet_pnl_correct ENGINE = MergeTree() ORDER BY wallet_address AS
        SELECT
          wallet_address,
          SUM(CASE WHEN realized_gain > 0 THEN realized_gain ELSE 0 END) as total_gains,
          SUM(CASE WHEN realized_loss < 0 THEN ABS(realized_loss) ELSE 0 END) as total_losses,
          total_gains - total_losses as net_pnl
        FROM (
          SELECT
            wallet_address,
            condition_id_norm,
            CASE 
              WHEN resolved = 1 AND winning_outcome IS NOT NULL
              THEN (payout_value - cost_basis)
              ELSE 0
            END as realized_gain,
            CASE
              WHEN resolved = 1 AND winning_outcome IS NULL
              THEN (payout_value - cost_basis)
              ELSE 0
            END as realized_loss,
            payout_value,
            cost_basis
          FROM (
            SELECT
              wallet_address,
              condition_id_norm,
              resolved,
              winning_outcome,
              SUM(CASE WHEN side = 'BUY' THEN amount_usdc ELSE 0 END) as cost_basis,
              COUNT(*) as trade_count,
              MAX(payout_numerators) as payout_numerators,
              MAX(payout_denominator) as payout_denominator,
              CASE
                WHEN resolved = 1
                THEN (SUM(CASE WHEN side != 'BUY' THEN amount_usdc ELSE 0 END))
                ELSE 0
              END as payout_value
            FROM trades_raw
            GROUP BY wallet_address, condition_id_norm, resolved, winning_outcome
          )
        )
        GROUP BY wallet_address
      `
    });
    
    console.log("✓ Created wallet_pnl_correct");
    
    // Test with niggemon
    const result = await ch.query({
      query: `
        SELECT total_gains, total_losses, net_pnl
        FROM wallet_pnl_correct
        WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data;
    
    console.log("\nNiggemon P&L (from trades_raw):");
    console.log(`  Gains:  $${data[0][0]}`);
    console.log(`  Losses: $${data[0][1]}`);
    console.log(`  Net:    $${data[0][2]}`);
    console.log(`\n  Target: $101,949.55`);
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
