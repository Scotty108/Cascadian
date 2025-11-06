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
    console.log("=== DEBUG: Known Wallet Proxy Relationships ===\n");

    const knownWallets = [
      { name: "HolyMoses7", addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8" },
      { name: "niggemon", addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0" },
    ];

    for (const wallet of knownWallets) {
      console.log(`\n${wallet.name}: ${wallet.addr}\n`);

      // Get all proxies for this EOA
      const query = await ch.query({
        query: `SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets WHERE lower(user_eoa) = lower('${wallet.addr}') LIMIT 10`,
      });

      const text = await query.text();
      const data = JSON.parse(text);

      console.log(`Proxy wallets for this EOA:`);
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach((row: any, i: number) => {
          console.log(`  ${i + 1}. ${row.proxy_wallet}`);
        });
      }

      // Now check for trades for EACH of these proxies
      console.log(`\nChecking trades for these proxy_wallet addresses in pm_trades:\n`);

      for (const row of data.data || []) {
        const proxy = row.proxy_wallet;
        const tradeQuery = await ch.query({
          query: `SELECT COUNT(*) as cnt FROM pm_trades WHERE lower(proxy_wallet) = lower('${proxy}')`,
        });

        const tradeText = await tradeQuery.text();
        const tradeData = JSON.parse(tradeText);
        const count = tradeData.data?.[0]?.cnt || 0;

        console.log(`  ${proxy.slice(0, 14)}...: ${count} trades`);
      }
    }

    console.log("\n\n=== pm_trades data structure ===\n");

    // Show sample trades with all fields
    const sampleQuery = await ch.query({
      query: `SELECT * FROM pm_trades LIMIT 2`,
    });

    const sampleText = await sampleQuery.text();
    const sampleData = JSON.parse(sampleText);

    console.log("Sample trade structure:");
    if (sampleData.data && sampleData.data[0]) {
      console.log(JSON.stringify(sampleData.data[0], null, 2));
    }

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
