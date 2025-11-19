import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
});

(async () => {
  try {
    const tables = ["pm_erc1155_flats", "pm_user_proxy_wallets", "pm_trades"];

    for (const table of tables) {
      const q = await ch.query({ query: `SELECT COUNT(*) as cnt FROM ${table}` });
      const text = await q.text();
      const data = JSON.parse(text.trim());
      console.log(`${table}: ${data.cnt} rows`);
    }

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
  }
})();
