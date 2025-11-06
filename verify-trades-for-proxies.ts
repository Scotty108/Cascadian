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
    console.log("Checking TRADES data for known wallets and their proxies...\n");

    const knownWallets = [
      { name: "HolyMoses7", addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8" },
      { name: "niggemon", addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0" },
    ];

    for (const wallet of knownWallets) {
      console.log(`\n=== ${wallet.name} (${wallet.addr.slice(0, 12)}...) ===\n`);

      // Get their proxies
      const proxyQuery = await ch.query({
        query: `SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets WHERE lower(user_eoa) = lower('${wallet.addr}') ORDER BY proxy_wallet`,
      });

      const proxyText = await proxyQuery.text();
      const proxyLines = proxyText.trim().split("\n").filter((l) => l.trim());

      if (proxyLines.length > 1) {
        console.log(`Found ${proxyLines.length - 1} proxies. Checking trades for first proxy...\n`);

        try {
          const firstProxyResponse = proxyText.trim();
          const proxyData = JSON.parse(firstProxyResponse);
          const proxy = proxyData.data?.[0]?.proxy_wallet;

          console.log(`Trades for proxy: ${proxy.slice(0, 12)}...\n`);

          const tradesQuery = await ch.query({
            query: `SELECT COUNT(*) as total, COUNT(DISTINCT market_id) as markets FROM pm_trades WHERE lower(proxy_wallet) = lower('${proxy}')`,
          });

          const tradesText = await tradesQuery.text();
          const tradesData = JSON.parse(tradesText.trim());
          const stats = tradesData.data?.[0];

          console.log(`Total trades: ${stats?.total || 0}`);
          console.log(`Unique markets: ${stats?.markets || 0}`);

          // Show sample trades
          console.log(`\nSample trades:\n`);
          const sampleQuery = await ch.query({
            query: `SELECT side, market_id, outcome_id, size, price FROM pm_trades WHERE lower(proxy_wallet) = lower('${proxy}') LIMIT 5`,
          });

          const sampleText = await sampleQuery.text();
          const sampleLines = sampleText.trim().split("\n").filter((l) => l.trim());
          sampleLines.forEach((line) => {
            try {
              const row = JSON.parse(line);
              console.log(
                `  ${row.side} | Market: ${row.market_id.slice(0, 12)}... | Outcome: ${row.outcome_id} | Size: ${row.size.slice(0, 10)} | Price: ${row.price.slice(0, 6)}`
              );
            } catch (e) {}
          });
        } catch (e) {
          console.log(`Error parsing proxy: ${e}`);
        }
      } else {
        console.log("No proxies found!");
      }
    }

    // Show overall trades stats
    console.log("\n\n=== OVERALL pm_trades STATISTICS ===\n");

    const totalQuery = await ch.query({
      query: `SELECT COUNT(*) as total, COUNT(DISTINCT proxy_wallet) as proxies, COUNT(DISTINCT market_id) as markets FROM pm_trades`,
    });

    const totalText = await totalQuery.text();
    const totalData = JSON.parse(totalText.trim());
    const total = totalData.data?.[0];

    console.log(`Total trades in pm_trades: ${total?.total || 0}`);
    console.log(`Unique proxies: ${total?.proxies || 0}`);
    console.log(`Unique markets: ${total?.markets || 0}`);

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
