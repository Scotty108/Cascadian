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
    console.log("Debugging proxy_wallet values in pm_trades...\n");

    const q = await ch.query({
      query: `
        SELECT DISTINCT proxy_wallet, COUNT(*) as cnt
        FROM pm_trades
        GROUP BY proxy_wallet
        ORDER BY cnt DESC
        LIMIT 20
      `,
    });

    const text = await q.text();
    const data = JSON.parse(text);
    const rows = data.data || [];

    console.log("Unique proxy_wallet values:");
    rows.forEach((row: any) => {
      console.log(`  ${row.proxy_wallet}: ${row.cnt} fills`);
    });

    console.log("\n\nKnown wallet addresses:");
    console.log("  HolyMoses7: 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8");
    console.log("  niggemon: 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0");

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
  }
})();
