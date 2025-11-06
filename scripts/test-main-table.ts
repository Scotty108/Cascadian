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
    // Check count
    const countResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM erc1155_transfers`,
      format: "JSONEachRow",
    });

    const countText = await countResult.text();
    console.log("Count:", countText);

    // Check sample
    const sampleResult = await ch.query({
      query: `SELECT contract, token_id FROM erc1155_transfers LIMIT 5`,
      format: "JSONEachRow",
    });

    const sampleText = await sampleResult.text();
    console.log("\nSample contracts and token IDs:");
    console.log(sampleText);

    // Get top contracts
    const contractResult = await ch.query({
      query: `
        SELECT contract, COUNT(*) as cnt
        FROM erc1155_transfers
        GROUP BY contract
        ORDER BY cnt DESC
        LIMIT 10
      `,
      format: "JSONEachRow",
    });

    const contractText = await contractResult.text();
    console.log("\nTop contracts:");
    console.log(contractText);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
