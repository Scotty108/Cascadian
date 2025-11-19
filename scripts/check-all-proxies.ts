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
    console.log("=== All active proxies from pm_user_proxy_wallets ===\n");

    const activeQuery = await ch.query({
      query: `SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets WHERE is_active = 1 ORDER BY proxy_wallet`,
    });

    const activeText = await activeQuery.text();
    const activeData = JSON.parse(activeText);

    console.log("Active proxies that were fetched in Step 2:");
    const proxies = activeData.data || [];
    proxies.forEach((row: any, i: number) => {
      console.log(`  ${i + 1}. ${row.proxy_wallet}`);
    });

    console.log(`\nTotal: ${proxies.length} proxies\n`);

    // Check trades for each proxy
    console.log("=== Trades for each proxy (from pm_trades) ===\n");

    for (const row of proxies) {
      const proxy = row.proxy_wallet;
      const tradeQuery = await ch.query({
        query: `SELECT COUNT(*) as cnt FROM pm_trades WHERE lower(proxy_wallet) = lower('${proxy}')`,
      });

      const tradeText = await tradeQuery.text();
      const tradeData = JSON.parse(tradeText);
      const count = tradeData.data?.[0]?.cnt || 0;

      const isKnown =
        proxy.toLowerCase() === "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8".toLowerCase() ||
        proxy.toLowerCase() === "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0".toLowerCase();

      const marker = isKnown ? "⭐" : "  ";
      console.log(`${marker} ${proxy.slice(0, 14)}...: ${count} trades`);
    }

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
  }
})();
