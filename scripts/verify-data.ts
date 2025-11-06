#!/usr/bin/env npx tsx

import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@clickhouse/client";

const envPath = path.resolve("/Users/scotty/Projects/Cascadian-app/.env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        process.env[key] = rest.join("=");
      }
    }
  }
}

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function main() {
  try {
    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log("DATA VERIFICATION");
    console.log("════════════════════════════════════════════════════════════════════\n");

    const ctAddress = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";

    // Check pm_erc1155_flats
    console.log("1) pm_erc1155_flats table:\n");

    const flatResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats`,
      format: "JSONEachRow",
    });

    const flatText = await flatResult.text();
    const flatLines = flatText.trim().split("\n").filter((l) => l.trim());
    if (flatLines.length > 0) {
      const row = JSON.parse(flatLines[0]);
      console.log(`   Total rows: ${row.cnt}`);
    }

    // Sample from pm_erc1155_flats
    const sampleFlat = await ch.query({
      query: `SELECT contract, block_time, tx_hash FROM pm_erc1155_flats LIMIT 3`,
      format: "JSONEachRow",
    });

    const sampleFlatText = await sampleFlat.text();
    const sampleFlatLines = sampleFlatText.trim().split("\n").filter((l) => l.trim());
    console.log(`\n   Sample rows:`);
    for (const line of sampleFlatLines) {
      const row = JSON.parse(line);
      console.log(`     Contract: ${row.contract}`);
      console.log(`     Block time: ${row.block_time}`);
      console.log(`     Tx hash: ${row.tx_hash.substring(0, 16)}...`);
    }

    // Check pm_user_proxy_wallets
    console.log("\n2) pm_user_proxy_wallets table:\n");

    const proxyResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_user_proxy_wallets`,
      format: "JSONEachRow",
    });

    const proxyText = await proxyResult.text();
    const proxyLines = proxyText.trim().split("\n").filter((l) => l.trim());
    if (proxyLines.length > 0) {
      const row = JSON.parse(proxyLines[0]);
      console.log(`   Total rows: ${row.cnt}`);
      console.log(`   (Requires raw log data to populate)`);
    }

    // Check ctf_token_map
    console.log("\n3) ctf_token_map table:\n");

    const tokenResult = await ch.query({
      query: `SELECT COUNT(*) as total, countIf(market_id IS NOT NULL AND market_id != '') as enriched FROM ctf_token_map`,
      format: "JSONEachRow",
    });

    const tokenText = await tokenResult.text();
    const tokenLines = tokenText.trim().split("\n").filter((l) => l.trim());
    if (tokenLines.length > 0) {
      const row = JSON.parse(tokenLines[0]);
      console.log(`   Total rows: ${row.total}`);
      console.log(`   With market_id: ${row.enriched}`);
    }

    // Check markets view
    console.log("\n4) markets view:\n");

    const marketResult = await ch.query({
      query: `SELECT COUNT(*) as total, countIf(winning_outcome != '' AND winning_outcome IS NOT NULL) as resolved FROM markets`,
      format: "JSONEachRow",
    });

    const marketText = await marketResult.text();
    const marketLines = marketText.trim().split("\n").filter((l) => l.trim());
    if (marketLines.length > 0) {
      const row = JSON.parse(marketLines[0]);
      console.log(`   Total markets: ${row.total}`);
      console.log(`   Resolved markets: ${row.resolved}`);
    }

    console.log(`\n════════════════════════════════════════════════════════════════════\n`);

    await ch.close();
    process.exit(0);
  } catch (e) {
    console.error("\nError:", e);
    await ch.close();
    process.exit(1);
  }
}

main();
