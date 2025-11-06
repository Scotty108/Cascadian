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
    // Check full gamma_markets schema
    const result = await ch.query({
      query: `DESCRIBE TABLE gamma_markets`,
    });

    const text = await result.text();
    const json = JSON.parse(text);
    console.log("All gamma_markets columns:");
    for (const col of json.data) {
      console.log(`  ${col.name}`);
    }

    // Sample from gamma_markets
    const sampleResult = await ch.query({
      query: `SELECT * FROM gamma_markets LIMIT 1`,
    });

    const sampleText = await sampleResult.text();
    const sampleJson = JSON.parse(sampleText);
    console.log("\n\nSample from gamma_markets:");
    const sample = sampleJson.data[0];
    for (const [key, value] of Object.entries(sample)) {
      console.log(`  ${key}: ${value}`);
    }

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
