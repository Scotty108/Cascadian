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
    // List all tables
    const result = await ch.query({
      query: `SELECT name FROM system.tables WHERE database = currentDatabase() ORDER BY name`,
    });

    const text = await result.text();
    console.log("Available tables:");
    console.log(text);

    // Look for ERC1155 or logs related tables
    const logsResult = await ch.query({
      query: `SHOW TABLES LIKE '%log%' OR LIKE '%erc%'`,
    });

    const logsText = await logsResult.text();
    console.log("\n\nTables matching log or erc patterns:");
    console.log(logsText);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
