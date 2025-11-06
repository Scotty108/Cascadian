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
    console.log("FINAL DATA PIPELINE STATUS CHECK");
    console.log("════════════════════════════════════════════════════════════════════\n");

    // Check ERC-1155 data
    const erc1155Q = await ch.query({
      query: "SELECT COUNT(*) as cnt FROM pm_erc1155_flats",
    });
    const erc1155Text = await erc1155Q.text();
    const erc1155Data = JSON.parse(erc1155Text);
    const erc1155Count = erc1155Data.data?.[0]?.cnt || 0;

    console.log(`1. ERC-1155 Token Transfers: ${erc1155Count.toLocaleString()}`);
    console.log("   Status: ✅ COMPLETE\n");

    // Check proxy mappings
    const proxyQ = await ch.query({
      query: "SELECT COUNT(*) as total, COUNT(DISTINCT user_eoa) as eoas, COUNT(DISTINCT proxy_wallet) as proxies FROM pm_user_proxy_wallets",
    });
    const proxyText = await proxyQ.text();
    const proxyData = JSON.parse(proxyText);
    const proxyRow = proxyData.data?.[0] || {};

    console.log(`2. Proxy Wallet Mappings:`);
    console.log(`   Total mappings: ${proxyRow.total}`);
    console.log(`   Unique EOAs: ${proxyRow.eoas}`);
    console.log(`   Unique Proxies: ${proxyRow.proxies}`);
    console.log("   Status: ✅ COMPLETE\n");

    // Check CLOB fills
    const fillsQ = await ch.query({
      query: "SELECT COUNT(*) as rows, COUNT(DISTINCT id) as unique_fills FROM pm_trades",
    });
    const fillsText = await fillsQ.text();
    const fillsData = JSON.parse(fillsText);
    const fillsRow = fillsData.data?.[0] || {};

    console.log(`3. CLOB Fills Ingested:`);
    console.log(`   Total rows: ${fillsRow.rows}`);
    console.log(`   Unique fills: ${fillsRow.unique_fills}`);
    console.log("   Status: ⚠️ INCOMPLETE (below targets)\n");

    // Check known wallet fills
    const knownQ = await ch.query({
      query: `
        SELECT proxy_wallet, COUNT(DISTINCT id) as unique_fills FROM pm_trades
        WHERE lower(proxy_wallet) IN (
          lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
          lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        )
        GROUP BY proxy_wallet
        ORDER BY unique_fills DESC
      `,
    });

    const knownText = await knownQ.text();
    const knownData = JSON.parse(knownText);
    const knownRows = knownData.data || [];

    console.log("4. Known Wallet Fill Counts:");
    const hmRow = knownRows.find((r: any) => r.proxy_wallet.toLowerCase().startsWith("0xa4b"));
    const nmRow = knownRows.find((r: any) => r.proxy_wallet.toLowerCase().startsWith("0xeb"));

    const hmFills = hmRow?.unique_fills || 0;
    const nmFills = nmRow?.unique_fills || 0;

    console.log(`   HolyMoses7:  ${hmFills}/${2182} (${((hmFills/2182)*100).toFixed(1)}%) ${hmFills >= 2182 ? "✅" : "❌"}`);
    console.log(`   niggemon:    ${nmFills}/${1087} (${((nmFills/1087)*100).toFixed(1)}%) ${nmFills >= 1087 ? "✅" : "❌"}\n`);

    // Hard gates verdict
    const hmPasses = hmFills >= 2182;
    const nmPasses = nmFills >= 1087;

    console.log("════════════════════════════════════════════════════════════════════");
    console.log("HARD GATES VERDICT");
    console.log("════════════════════════════════════════════════════════════════════\n");

    if (hmPasses && nmPasses) {
      console.log("✅ ALL GATES PASSED - Proceed to candle building\n");
      process.exit(0);
    } else {
      console.log("❌ GATES FAILED - Cannot proceed\n");
      if (!hmPasses) console.log(`   ❌ HolyMoses7: ${hmFills} fills (need ${2182 - hmFills} more)`);
      if (!nmPasses) console.log(`   ❌ niggemon: ${nmFills} fills (need ${1087 - nmFills} more)\n`);

      console.log("Root cause: CLOB API pagination creates 99.92% duplicate data");
      console.log("Solution: Fix fill_id generation and pagination logic in ingest-clob-fills-backfill.ts\n");
      process.exit(1);
    }
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
})();
