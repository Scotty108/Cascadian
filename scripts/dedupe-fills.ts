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
    console.log("Optimizing pm_trades to deduplicate...");
    await ch.exec({
      query: "OPTIMIZE TABLE pm_trades FINAL",
    });
    console.log("✅ Deduplication complete\n");

    // Recount
    const q = await ch.query({
      query: "SELECT count() AS rows, uniqExact(fill_id) AS uniq FROM pm_trades",
    });
    const text = await q.text();
    const data = JSON.parse(text);
    const r = data.data[0];
    console.log(`After dedup: ${r.rows} rows, ${r.uniq} unique fill_ids\n`);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
  }
})();
