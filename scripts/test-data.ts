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
      query: `SELECT COUNT(*) as cnt FROM erc1155_transfers_staging`,
      format: "JSONEachRow",
    });

    const countText = await countResult.text();
    console.log("Count response:", countText);

    // Check sample
    const sampleResult = await ch.query({
      query: `SELECT address, topics[1] as sig FROM erc1155_transfers_staging LIMIT 5`,
      format: "JSONEachRow",
    });

    const sampleText = await sampleResult.text();
    console.log("\nSample response:");
    console.log(sampleText);

    // Count by signature
    const sigResult = await ch.query({
      query: `
        SELECT topics[1] as sig, COUNT(*) as cnt
        FROM erc1155_transfers_staging
        GROUP BY sig
        ORDER BY cnt DESC
        LIMIT 10
      `,
      format: "JSONEachRow",
    });

    const sigText = await sigResult.text();
    console.log("\nSignatures:");
    console.log(sigText);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
