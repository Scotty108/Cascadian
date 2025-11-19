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
    const CT = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
    const sample = await ch.query({
      query: `SELECT * FROM erc1155_transfers WHERE lower(contract) = lower('${CT}') LIMIT 3`,
    });

    const sampleText = await sample.text();
    const sampleData = JSON.parse(sampleText);

    console.log("Sample ERC1155 transfer rows:\n");
    (sampleData.data || []).forEach((row: any, i: number) => {
      console.log(`Row ${i + 1}:`);
      console.log(`  from_address: "${row.from_address}" (type: ${typeof row.from_address})`);
      console.log(`  to_address: "${row.to_address}" (type: ${typeof row.to_address})`);
      console.log(`  value: ${row.value} (type: ${typeof row.value})`);
      console.log(`  operator: "${row.operator}"`);
      console.log(`  token_id: "${row.token_id}"`);
      console.log();
    });

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
  }
})();
