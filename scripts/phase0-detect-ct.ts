#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("PHASE 0: AUTODETECT CONDITIONALTOKENS ADDRESS");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    console.log("Querying erc1155_transfers...\n");

    const result = await ch.query({
      query: `
        SELECT contract as address, count() AS n
        FROM erc1155_transfers
        GROUP BY contract
        ORDER BY n DESC
        LIMIT 5
      `,
    });

    const text = await result.text();

    // Parse JSON response
    let responseData: any;
    try {
      responseData = JSON.parse(text);
    } catch {
      // If not JSON, try to parse as tab-separated
      const lines = text.trim().split("\n").filter((l) => l.trim());
      if (lines.length > 0) {
        const ctAddress = lines[0].split(/\s+/)[0];
        console.log("\n════════════════════════════════════════════════════════════════════");
        console.log(`DETECTED CONDITIONAL TOKENS ADDRESS: ${ctAddress}`);
        console.log("════════════════════════════════════════════════════════════════════\n");
        console.log(`export CONDITIONAL_TOKENS="${ctAddress}"\n`);
        process.exit(0);
      }
      throw new Error("Could not parse response");
    }

    if (!responseData.data || responseData.data.length === 0) {
      throw new Error("No data in response");
    }

    const row = responseData.data[0];
    const ctAddress = row.address;
    const count = row.n;

    console.log("Top ERC1155 contract addresses:");
    console.log("────────────────────────────────────────────────────────────────────\n");
    for (const r of responseData.data) {
      console.log(`  ${r.address} - ${r.n} transfers`);
    }

    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log(`DETECTED CONDITIONAL TOKENS ADDRESS: ${ctAddress}`);
    console.log(`ERC1155 transfers: ${count}`);
    console.log("════════════════════════════════════════════════════════════════════\n");

    console.log(`Export this command in your shell:\n`);
    console.log(`export CONDITIONAL_TOKENS="${ctAddress}"\n`);

    process.exit(0);

  } catch (e: any) {
    console.error("ERROR in Phase 0:", e.message || e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
