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
    console.log("Checking proxy mapping for known wallets...\n");

    const knownWallets = [
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", // HolyMoses7
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", // niggemon
    ];

    for (const eoa of knownWallets) {
      console.log(`\n=== Wallet: ${eoa.slice(0, 12)}... ===\n`);

      // Check as user_eoa
      const userQuery = await ch.query({
        query: `SELECT proxy_wallet, first_seen_at, last_seen_at FROM pm_user_proxy_wallets WHERE lower(user_eoa) = lower('${eoa}')`,
      });

      const userText = await userQuery.text();
      const userLines = userText.trim().split("\n").filter((l) => l.trim());

      console.log(`As user_eoa: ${userLines.length - 1 || 0} proxies found`);
      if (userLines.length > 1) {
        userLines.slice(1, 4).forEach((line) => {
          try {
            const row = JSON.parse(line);
            console.log(`  - ${row.proxy_wallet.slice(0, 12)}...`);
          } catch (e) {}
        });
        if (userLines.length > 4) {
          console.log(`  ... and ${userLines.length - 4} more`);
        }
      }

      // Check if wallet itself is a proxy
      const proxyQuery = await ch.query({
        query: `SELECT user_eoa, first_seen_at, last_seen_at FROM pm_user_proxy_wallets WHERE lower(proxy_wallet) = lower('${eoa}')`,
      });

      const proxyText = await proxyQuery.text();
      const proxyLines = proxyText.trim().split("\n").filter((l) => l.trim());

      console.log(`\nAs proxy_wallet: ${proxyLines.length - 1 || 0} user relationships found`);
      if (proxyLines.length > 1) {
        proxyLines.slice(1, 4).forEach((line) => {
          try {
            const row = JSON.parse(line);
            console.log(`  - Proxy for: ${row.user_eoa.slice(0, 12)}...`);
          } catch (e) {}
        });
        if (proxyLines.length > 4) {
          console.log(`  ... and ${proxyLines.length - 4} more`);
        }
      }

      // Check ERC1155 activity for both from_addr and to_addr
      console.log(`\nERC1155 activity for ${eoa.slice(0, 12)}...:`);

      const fromQuery = await ch.query({
        query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats WHERE lower(from_addr) = lower('${eoa}')`,
      });

      const fromText = await fromQuery.text();
      const fromData = JSON.parse(fromText.trim());
      console.log(`  As from_addr (sender): ${fromData.data?.[0]?.cnt || 0} transfers`);

      const toQuery = await ch.query({
        query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats WHERE lower(to_addr) = lower('${eoa}')`,
      });

      const toText = await toQuery.text();
      const toData = JSON.parse(toText.trim());
      console.log(`  As to_addr (receiver): ${toData.data?.[0]?.cnt || 0} transfers`);
    }

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
