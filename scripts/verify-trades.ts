import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

(async () => {
  try {
    console.log("Checking pm_trades table...");

    const result = await ch.query({
      query: "SELECT COUNT(*) as cnt, COUNT(DISTINCT proxy_wallet) as proxies FROM pm_trades",
    });

    const text = await result.text();
    const data = JSON.parse(text.trim());

    console.log(`Total trades: ${data.cnt}`);
    console.log(`Unique proxies: ${data.proxies}`);

    // Show sample
    const sample = await ch.query({
      query: "SELECT proxy_wallet, market_id, side, size, price FROM pm_trades LIMIT 3",
    });

    const sampleText = await sample.text();
    console.log("\nSample trades:");
    console.log(sampleText);

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
  }
})();
