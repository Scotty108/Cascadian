#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function checkTable(tableName: string, walletCol: string, pnlCol: string) {
  try {
    const result = await ch.query({
      query: `
        SELECT
          '${tableName}' as table_name,
          COUNT(*) as row_count,
          SUM(CASE WHEN ${walletCol} IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0') THEN 1 ELSE 0 END) as target_wallets_count,
          ROUND(SUM(CASE WHEN ${walletCol} = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0' THEN CAST(${pnlCol} AS Float64) ELSE 0 END), 2) as niggemon_pnl,
          ROUND(SUM(CASE WHEN ${walletCol} = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8' THEN CAST(${pnlCol} AS Float64) ELSE 0 END), 2) as holymoses_pnl
        FROM ${tableName}
        LIMIT 1
      `,
      format: "JSONCompact"
    });
    const text = await result.text();
    const data = JSON.parse(text).data;
    return data[0];
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECKING EXISTING P&L TABLES FOR CORRECT DATA");
  console.log("Target: niggemon=$102,001.46, HolyMoses7=$89,975.16");
  console.log("════════════════════════════════════════════════════════════════\n");

  const tablesToCheck = [
    { name: 'wallet_pnl_correct', wallet: 'wallet_address', pnl: 'total_pnl' },
    { name: 'wallet_pnl_final_summary', wallet: 'wallet', pnl: 'total_pnl' },
    { name: 'wallet_pnl_summary_final', wallet: 'wallet', pnl: 'total_pnl' },
    { name: 'wallet_pnl_summary_v2', wallet: 'wallet', pnl: 'total_pnl_usd' },
    { name: 'wallet_realized_pnl_v3', wallet: 'wallet', pnl: 'realized_pnl_usd' },
    { name: 'wallet_pnl_summary', wallet: 'wallet_address', pnl: 'total_pnl_usd' },
    { name: 'portfolio_mtm_detailed', wallet: 'wallet', pnl: 'unrealized_pnl_usd' },
  ];

  for (const table of tablesToCheck) {
    const result = await checkTable(table.name, table.wallet, table.pnl);
    if (result) {
      const rowCount = result[1];
      const targetCount = result[2];
      const niggemonPnl = parseFloat(result[3]);
      const holyPnl = parseFloat(result[4]);
      
      const nigVariance = ((niggemonPnl - 102001.46) / 102001.46 * 100);
      const holyVariance = ((holyPnl - 89975.16) / 89975.16 * 100);
      
      const nigIcon = Math.abs(nigVariance) < 10 ? "✅" : Math.abs(nigVariance) < 50 ? "⚠️" : "❌";
      const holyIcon = Math.abs(holyVariance) < 10 ? "✅" : Math.abs(holyVariance) < 50 ? "⚠️" : "❌";
      
      console.log(`${nigIcon} ${table.name.padEnd(28)} (${rowCount} rows)`);
      console.log(`   niggemon: $${niggemonPnl.toLocaleString()} (${nigVariance.toFixed(1)}%)`);
      console.log(`   ${holyIcon} holymoses: $${holyPnl.toLocaleString()} (${holyVariance.toFixed(1)}%)\n`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
