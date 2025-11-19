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
    console.log("=== Actual proxy_wallet values in pm_trades ===\n");

    const query = await ch.query({
      query: `SELECT DISTINCT proxy_wallet FROM pm_trades ORDER BY proxy_wallet`,
    });

    const text = await query.text();
    const data = JSON.parse(text);

    console.log("Distinct proxy_wallet values (first 20):\n");
    const proxies = (data.data || []).slice(0, 20);
    proxies.forEach((row: any, i: number) => {
      const knownWallets = [
        "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
        "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
        "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
        "0x56c79347e95530c01a2fc76e732f9566da16e113",
        "0xd91e80cf2e7be2e162c6513ced06f1dd0da35296",
      ];

      const isKnown = knownWallets.some((w) => w.toLowerCase() === row.proxy_wallet.toLowerCase());
      const marker = isKnown ? "⭐" : "  ";

      console.log(`${marker} ${i + 1}. ${row.proxy_wallet}`);
    });

    const totalQuery = await ch.query({
      query: `SELECT COUNT(DISTINCT proxy_wallet) as total FROM pm_trades`,
    });

    const totalText = await totalQuery.text();
    const totalData = JSON.parse(totalText);
    const total = totalData.data?.[0]?.total || 0;

    console.log(`\nTotal distinct proxy_wallet values: ${total}`);

    // Sample a trade to see the structure
    console.log("\n=== Sample trade from pm_trades ===\n");

    const sampleQuery = await ch.query({
      query: `SELECT * FROM pm_trades LIMIT 1`,
    });

    const sampleText = await sampleQuery.text();
    const sampleData = JSON.parse(sampleText);

    if (sampleData.data && sampleData.data[0]) {
      const sample = sampleData.data[0];
      console.log(`proxy_wallet: ${sample.proxy_wallet}`);
      console.log(`market_id: ${sample.market_id}`);
      console.log(`outcome_id: ${sample.outcome_id}`);
      console.log(`side: ${sample.side}`);
      console.log(`size: ${sample.size}`);
      console.log(`price: ${sample.price}`);
      console.log(`ts: ${sample.ts}`);
    }

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
  }
})();
