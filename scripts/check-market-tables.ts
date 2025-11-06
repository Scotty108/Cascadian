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
    // Check market_resolutions_final structure
    const result = await ch.query({
      query: `DESCRIBE TABLE market_resolutions_final`,
    });

    const text = await result.text();
    console.log("market_resolutions_final schema:");
    const json = JSON.parse(text);
    console.log(JSON.stringify(json.data?.slice(0, 20), null, 2));

    // Check gamma_markets structure
    const result2 = await ch.query({
      query: `DESCRIBE TABLE gamma_markets`,
    });

    const text2 = await result2.text();
    console.log("\n\ngamma_markets schema:");
    const json2 = JSON.parse(text2);
    console.log(JSON.stringify(json2.data?.slice(0, 20), null, 2));

    // Sample from market_resolutions_final
    const sampleResult = await ch.query({
      query: `SELECT * FROM market_resolutions_final LIMIT 1`,
    });

    const sampleText = await sampleResult.text();
    console.log("\n\nSample from market_resolutions_final:");
    const sampleJson = JSON.parse(sampleText);
    console.log(JSON.stringify(sampleJson.data, null, 2));

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
