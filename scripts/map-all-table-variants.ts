#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function getTableInfo(tableName: string) {
  try {
    // Get row count
    const countResult = await ch.query({
      query: `SELECT count() FROM ${tableName}`,
      format: "JSONCompact"
    });
    const countText = await countResult.text();
    const countData = JSON.parse(countText).data || [];
    const rowCount = parseInt(countData[0][0]);

    // Get columns
    const colResult = await ch.query({
      query: `SELECT name FROM system.columns WHERE table = '${tableName}' AND database = 'default' ORDER BY position`,
      format: "JSONCompact"
    });
    const colText = await colResult.text();
    const colData = JSON.parse(colText).data || [];
    const columns = colData.map(row => row[0]);

    // Sample data if small
    let sample = null;
    if (rowCount < 100) {
      try {
        const sampleResult = await ch.query({
          query: `SELECT * FROM ${tableName} LIMIT 3`,
          format: "JSONCompact"
        });
        const sampleText = await sampleResult.text();
        sample = JSON.parse(sampleText).data || [];
      } catch { }
    }

    return {
      name: tableName,
      rowCount,
      columns,
      sample: sample ? `${sample.length} rows` : "table too large"
    };
  } catch (e: any) {
    return {
      name: tableName,
      error: e.message.split('\n')[0].substring(0, 50)
    };
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("COMPREHENSIVE TABLE INVENTORY: P&L System v1, v2, v3");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Search for all PnL-related tables
  const tablePatterns = [
    // Core data sources
    'outcome_positions_v2',
    'trade_cashflows_v3',
    'trade_flows_v2',
    'trades_raw',
    'trades_canonical',
    
    // Winning index
    'winning_index',
    'canonical_condition',
    
    // P&L aggregates
    'realized_pnl_by_market_v1',
    'realized_pnl_by_market_v2',
    'realized_pnl_by_market_v3',
    'realized_pnl_by_market_final',
    
    'wallet_realized_pnl_v1',
    'wallet_realized_pnl_v2',
    'wallet_realized_pnl_v3',
    'wallet_realized_pnl_final',
    
    'wallet_pnl_summary_v1',
    'wallet_pnl_summary_v2',
    'wallet_pnl_summary_v3',
    'wallet_pnl_summary_final',
    
    'wallet_unrealized_pnl_v1',
    'wallet_unrealized_pnl_v2',
    'wallet_unrealized_pnl_final',
    
    // Alternative names
    'wallet_pnl_correct',
    'wallet_pnl_final',
    'pnl_by_condition',
    'realized_pnl_corrected'
  ];

  console.log("Table Status Inventory:\n");
  console.log("─".repeat(90));

  let coreFound = [];
  let pnlFound = [];

  for (const tableName of tablePatterns) {
    const info = await getTableInfo(tableName);
    
    if (info.error) {
      // Silently skip
    } else {
      console.log(`✅ ${info.name.padEnd(40)}`);
      console.log(`   Rows: ${info.rowCount.toLocaleString()}`);
      console.log(`   Columns: ${info.columns.join(', ')}`);
      console.log();

      if (['outcome_positions_v2', 'trade_cashflows_v3', 'trade_flows_v2', 'trades_raw', 'canonical_condition', 'winning_index'].includes(info.name)) {
        coreFound.push(info.name);
      } else {
        pnlFound.push(info.name);
      }
    }
  }

  console.log("═".repeat(90));
  console.log("\nSUMMARY:\n");
  console.log(`Core Data Sources Found: ${coreFound.length}`);
  coreFound.forEach(t => console.log(`  - ${t}`));
  console.log(`\nP&L Aggregate Tables Found: ${pnlFound.length}`);
  pnlFound.forEach(t => console.log(`  - ${t}`));

  console.log("\n" + "═".repeat(90) + "\n");
}

main().catch(console.error);
