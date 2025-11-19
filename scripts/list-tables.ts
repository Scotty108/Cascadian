#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function main() {
  const result = await ch.query({
    query: "SHOW TABLES LIKE '%trade%'",
    format: "JSONCompact"
  });

  const text = await result.text();
  const data = JSON.parse(text).data;
  
  console.log("Available trade tables:");
  for (const row of data) {
    console.log(`  - ${row[0]}`);
  }
}

main().catch(console.error);
