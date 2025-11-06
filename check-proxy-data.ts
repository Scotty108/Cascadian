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
    const q = await ch.query({
      query: "SELECT COUNT(*) as cnt, COUNT(DISTINCT user_eoa) as uniq_eoas FROM pm_user_proxy_wallets",
    });
    const text = await q.text();
    const data = JSON.parse(text);
    const row = data.data?.[0] || {};

    console.log(`Proxy wallets table:`);
    console.log(`  Total rows: ${row.cnt}`);
    console.log(`  Unique EOAs: ${row.uniq_eoas}`);

    // Check known wallets
    const knownQ = await ch.query({
      query: `
        SELECT lower(user_eoa) as eoa, COUNT(*) as proxy_cnt
        FROM pm_user_proxy_wallets
        WHERE lower(user_eoa) IN (
          lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
          lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        )
        GROUP BY user_eoa
      `,
    });

    const knownText = await knownQ.text();
    const knownData = JSON.parse(knownText);
    const knownRows = knownData.data || [];

    console.log("\nKnown wallets in proxy table:");
    knownRows.forEach((row: any) => {
      const name = row.eoa.startsWith("0xa4b") ? "HolyMoses7" : "niggemon";
      console.log(`  ${name}: ${row.proxy_cnt} proxies`);
    });

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
  }
})();
