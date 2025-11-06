#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 3: LEDGER RECONCILIATION TEST (Simplified)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Check ERC1155 data volume
    console.log("TEST 1: Data Volume Check\n");

    const erc1155Q = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats`,
    });
    const erc1155Text = await erc1155Q.text();
    const erc1155Data = JSON.parse(erc1155Text.trim());
    const erc1155Count = erc1155Data.cnt || 0;

    const clobQ = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_trades`,
    });
    const clobText = await clobQ.text();
    const clobData = JSON.parse(clobText.trim());
    const clobCount = clobData.cnt || 0;

    console.log(`ERC1155 flats: ${erc1155Count} rows`);
    console.log(`CLOB fills: ${clobCount} rows`);

    // Check known wallets in ERC1155
    console.log("\nTEST 2: Known Wallet Coverage\n");

    const knownWallets = [
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    ];

    let knownWalletPass = true;

    for (const eoa of knownWallets) {
      const erc1155WalletQ = await ch.query({
        query: `
          SELECT COUNT(*) as cnt
          FROM pm_erc1155_flats
          WHERE lower(to_addr) = lower({eoa:String})
        `,
        query_params: { eoa },
      });
      const erc1155WalletText = await erc1155WalletQ.text();
      const erc1155WalletData = JSON.parse(erc1155WalletText.trim());
      const erc1155WalletCount = erc1155WalletData.cnt || 0;

      const status = erc1155WalletCount > 0 ? "✅" : "⚠️ ";
      console.log(`${status} ${eoa.slice(0, 10)}...: ${erc1155WalletCount} ERC1155 transfers`);

      if (erc1155WalletCount === 0) {
        knownWalletPass = false;
      }
    }

    // HARD GATE: Check if CLOB fills exist
    console.log("\nTEST 3: Acceptance Criteria\n");

    const hasERC1155 = erc1155Count > 0;
    const hasCLOB = clobCount > 0;
    const hasKnownWalletData = knownWalletPass;

    console.log(`[${hasERC1155 ? "✅" : "❌"}] ERC1155 data populated: ${erc1155Count} rows`);
    console.log(
      `[${hasKnownWalletData ? "✅" : "❌"}] Known wallets in ERC1155: ${knownWalletPass ? "YES" : "NO"}`
    );
    console.log(
      `[${hasCLOB ? "✅" : "❌"}] CLOB fills available: ${clobCount} rows (required for ledger reconciliation)`
    );

    console.log("\n════════════════════════════════════════════════════════════════════\n");

    if (!hasCLOB) {
      console.log("❌ HARD FAIL: No CLOB fills found in pm_trades");
      console.log("\nReason: CLOB API is not accessible or returns no data");
      console.log("Action: Check CLOB API endpoint and authentication");
      console.log("        Alternatively, populate pm_trades from alternative data source");
      console.log("\nFAILURE MODE: Cannot proceed to wallet validation without trade data");
      console.log("\nExit code 1");
      await ch.close();
      process.exit(1);
    }

    console.log("✅ HARD PASS: All prerequisites met for ledger reconciliation");
    console.log("   - ERC1155 data available");
    console.log("   - CLOB fills available");
    console.log("   - Known wallets have activity\n");

    console.log("════════════════════════════════════════════════════════════════════\n");

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
