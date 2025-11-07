import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
});

async function main() {
  try {
    const result = await ch.query({ query: "DESCRIBE TABLE outcome_positions_v2", format: "JSONCompact" });
    const text = await result.text();
    const parsed = JSON.parse(text);
    console.log("outcome_positions_v2 columns (first 10):");
    if (parsed.data) {
      for (let i = 0; i < Math.min(10, parsed.data.length); i++) {
        const row = parsed.data[i];
        console.log(`  ${row[0]} : ${row[1]}`);
      }
    }
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main().catch(console.error);
