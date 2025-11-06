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
    // Check if any table has both topics and address
    const tables = ["events_dim", "id_bridge", "api_ctf_bridge"];

    for (const table of tables) {
      console.log(`\nChecking ${table}...`);
      try {
        const result = await ch.query({
          query: `DESCRIBE TABLE ${table}`,
        });
        const text = await result.text();
        if (text.includes("topics") && text.includes("address")) {
          console.log(`  Found topics and address in ${table}`);
          const json = JSON.parse(text);
          console.log(JSON.stringify(json.data?.slice(0, 10), null, 2));
        } else {
          console.log(`  No topics or address in ${table}`);
        }
      } catch (e) {
        console.log(`  Table not found or error: ${table}`);
      }
    }

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
