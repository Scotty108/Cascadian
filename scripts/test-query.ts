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
      query: `
        SELECT address, count() AS n
        FROM erc1155_transfers_staging
        WHERE topics[1] IN (
          '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
          '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
        )
        GROUP BY address
        ORDER BY n DESC
        LIMIT 5
      `,
      format: "JSONEachRow",
    });

    const text = await result.text();
    console.log("Raw response:");
    console.log(text);
    console.log("\nResponse length:", text.length);

    const lines = text.trim().split("\n").filter(l => l.trim());
    console.log("\nLines:", lines.length);
    console.log("Lines:", lines);

    if (lines.length > 0) {
      try {
        const parsed = JSON.parse(lines[0]);
        console.log("Parsed first line:", parsed);
      } catch (e) {
        console.log("Error parsing first line:", e);
      }
    }

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
