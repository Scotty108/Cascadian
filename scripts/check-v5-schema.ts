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
});

(async () => {
  console.log('\n=== vw_pm_realized_pnl_v5 Schema ===\n');
  const result = await ch.query({
    query: 'DESCRIBE vw_pm_realized_pnl_v5',
    format: 'JSONEachRow'
  });
  const text = await result.text();
  const rows = text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.table(rows);

  await ch.close();
})();
