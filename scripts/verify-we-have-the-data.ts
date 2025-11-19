#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

const ch = getClickHouseClient();

const testWallet = "0x8e9eedf20dfa70956d49f608a205e402d9df38e4";

// Tables user mentioned with their claimed row counts
const userTables = [
  { name: "trades_raw_with_full_pnl", expected: 159574259, db: "default" },
  { name: "trade_direction_assignments", expected: 129599951, db: "default" },
  { name: "trades_with_direction", expected: 82138586, db: "default" },
  { name: "vw_trades_canonical", expected: 157541131, db: "default" },
  { name: "trade_cashflows_v3", expected: 35874799, db: "default" },
  { name: "wallet_metrics", expected: 996334, db: "default" },
  { name: "wallet_metrics_v1", expected: 986655, db: "default" },
  { name: "erc20_transfers_staging", expected: 387728806, db: "default" },
  { name: "erc20_transfers_decoded", expected: 21103660, db: "default" },
  { name: "gamma_markets", expected: 149907, db: "default" },
  { name: "gamma_resolved", expected: 123245, db: "default" },
  { name: "market_resolutions_final", expected: 224396, db: "default" },
  { name: "market_id_mapping", expected: 187071, db: "default" },
  { name: "market_key_map", expected: 156952, db: "default" },
  { name: "api_ctf_bridge", expected: 156952, db: "default" },
  { name: "condition_market_map", expected: 151843, db: "default" },
  { name: "erc1155_transfers", expected: 291113, db: "default" },
  { name: "outcome_positions_v2", expected: 8374571, db: "default" },
  { name: "fact_trades_clean", expected: 63541461, db: "cascadian_clean" },
  { name: "system_wallet_map", expected: 23252314, db: "cascadian_clean" },
];

async function checkTable(
  tableName: string,
  database: string,
  expectedCount: number
) {
  try {
    // Check if table exists
    const existsQ = await ch.query({
      query: `SELECT count() as cnt FROM system.tables WHERE database = '${database}' AND name = '${tableName}'`,
    });
    const existsResult = await existsQ.json();
    const exists = existsResult.data[0].cnt > 0;

    if (!exists) {
      console.log(`❌ ${database}.${tableName}: TABLE DOES NOT EXIST`);
      return null;
    }

    // Get total row count
    const countQ = await ch.query({
      query: `SELECT count() as cnt FROM ${database}.${tableName}`,
    });
    const countResult = await countQ.json();
    const totalRows = countResult.data[0].cnt;

    // Get schema to find wallet column
    const schemaQ = await ch.query({
      query: `DESCRIBE TABLE ${database}.${tableName}`,
    });
    const schemaResult = await schemaQ.json();
    const walletCols = schemaResult.data
      .map((r: any) => r.name)
      .filter(
        (n: string) =>
          n.toLowerCase().includes("wallet") ||
          n.toLowerCase().includes("address") ||
          n.toLowerCase().includes("from_") ||
          n.toLowerCase().includes("to_")
      );

    // Try to find test wallet in this table
    let testWalletCount = 0;
    if (walletCols.length > 0) {
      const walletCol = walletCols[0]; // Use first wallet-like column
      try {
        const walletQ = await ch.query({
          query: `SELECT count() as cnt FROM ${database}.${tableName} WHERE lower(${walletCol}) = lower('${testWallet}')`,
        });
        const walletResult = await walletQ.json();
        testWalletCount = walletResult.data[0].cnt;
      } catch (e) {
        // Column might not support WHERE, skip
      }
    }

    const match =
      Math.abs(totalRows - expectedCount) / expectedCount < 0.01
        ? "✅"
        : totalRows > 0
        ? "⚠️"
        : "❌";

    console.log(
      `${match} ${database}.${tableName}:`
    );
    console.log(
      `   Total: ${totalRows.toLocaleString()} (expected: ${expectedCount.toLocaleString()})`
    );
    if (testWalletCount > 0) {
      console.log(`   Test wallet: ${testWalletCount.toLocaleString()} rows`);
    }

    return { exists: true, totalRows, testWalletCount };
  } catch (e: any) {
    console.log(
      `⚠️ ${database}.${tableName}: ERROR - ${e.message.substring(0, 80)}`
    );
    return null;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("VERIFYING: DO WE ALREADY HAVE THE DATA?");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log(`Test wallet: ${testWallet}`);
  console.log(`Expected from Polymarket: ~2,636 predictions\n`);
  console.log(
    "Checking tables from user's notes...\n"
  );

  let totalTestWalletRows = 0;
  let existingTables = 0;

  for (const table of userTables) {
    const result = await checkTable(table.name, table.db, table.expected);
    if (result && result.exists) {
      existingTables++;
      totalTestWalletRows += result.testWalletCount;
    }
    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("\nSUMMARY:");
  console.log(
    `Tables found: ${existingTables}/${userTables.length}`
  );
  console.log(
    `Test wallet total appearances: ${totalTestWalletRows.toLocaleString()}`
  );

  if (totalTestWalletRows >= 2000) {
    console.log(
      "\n✅ SUCCESS: We likely already have the data!"
    );
    console.log("   Test wallet appears in multiple large tables.");
    console.log("   No need to ingest CLOB data - it's already here.\n");
  } else {
    console.log(
      "\n⚠️  WARNING: Data appears incomplete"
    );
    console.log(
      `   Test wallet only appears ${totalTestWalletRows} times (expected ~2,636)`
    );
    console.log("   May need to investigate further or run CLOB ingestion.\n");
  }

  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
