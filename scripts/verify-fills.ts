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
    console.log("════════════════════════════════════════════════════════════════════");
    console.log("VERIFY: Fills count and deduplication");
    console.log("════════════════════════════════════════════════════════════════════\n");

    // Count vs uniques
    const countQ = await ch.query({
      query: `SELECT count() AS rows, uniqExact(fill_id) AS uniq FROM pm_trades`,
    });

    const countText = await countQ.text();
    const countData = JSON.parse(countText);
    const stats = countData.data ? countData.data[0] : {};

    console.log(`Total rows: ${stats.rows}`);
    console.log(`Unique fill_ids: ${stats.uniq}`);
    const isDedupd = stats.rows === stats.uniq;
    console.log(`Dedup status: ${isDedupd ? "✅ Perfect" : "⚠️  Has dupes"}\n`);

    // By wallet sanity
    const walletQ = await ch.query({
      query: `SELECT proxy_wallet, count() AS fills FROM pm_trades GROUP BY proxy_wallet ORDER BY fills DESC LIMIT 10`,
    });

    const walletText = await walletQ.text();
    const walletData = JSON.parse(walletText);

    console.log("Top 10 wallets by fill count:\n");
    const wallets = walletData.data || [];
    wallets.forEach((row: any) => {
      const knownWallets = [
        "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
        "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
      ];
      const marker = knownWallets.some((w) => w.toLowerCase() === row.proxy_wallet.toLowerCase()) ? "⭐" : "  ";
      console.log(`${marker} ${row.proxy_wallet.slice(0, 14)}...: ${row.fills} fills`);
    });

    console.log("\n════════════════════════════════════════════════════════════════════\n");

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
  }
})();
