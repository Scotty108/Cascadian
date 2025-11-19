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
    console.log("Checking pm_erc1155_flats table...\n");

    const countResult = await ch.query({
      query: "SELECT COUNT(*) as total FROM pm_erc1155_flats",
    });

    const countText = await countResult.text();
    console.log("Count response:", countText);

    // Show sample data
    console.log("\nSample ERC1155 transfers:\n");
    const sample = await ch.query({
      query: "SELECT block_number, from_addr, to_addr, id_hex, value_raw_hex FROM pm_erc1155_flats LIMIT 5",
    });

    const sampleText = await sample.text();
    const lines = sampleText.trim().split("\n");
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        console.log(`Block ${row.block_number}: ${row.from_addr?.slice(0, 10)}... → ${row.to_addr?.slice(0, 10)}... | Token: ${row.id_hex?.slice(0, 16)}... | Amount: ${row.value_raw_hex?.slice(0, 20)}...`);
      } catch (e) {
        // Skip non-JSON lines
      }
    }

    // Check known wallet activity
    console.log("\nKnown wallet activity in ERC1155:\n");
    const knownWallets = [
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    ];

    for (const eoa of knownWallets) {
      const q = await ch.query({
        query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats WHERE lower(to_addr) = lower('${eoa}')`,
      });

      const text = await q.text();
      console.log(`${eoa.slice(0, 12)}...: ${text}`);
    }

    await ch.close();
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
