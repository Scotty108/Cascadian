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
    const result = await ch.query({
      query: `DESCRIBE TABLE pm_erc1155_flats`,
    });

    const text = await result.text();
    console.log("pm_erc1155_flats schema:");
    const json = JSON.parse(text);
    console.log(JSON.stringify(json.data, null, 2));

    const countResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats`,
      format: "JSONEachRow",
    });

    const countText = await countResult.text();
    console.log("\nCount:", countText);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
