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
    const result = await ch.query({
      query: "DESCRIBE erc1155_transfers",
    });

    const text = await result.text();
    console.log("erc1155_transfers schema:\n");
    console.log(text);

    // Show sample
    const sample = await ch.query({
      query: "SELECT * FROM erc1155_transfers LIMIT 1",
    });

    const sampleText = await sample.text();
    const sampleData = JSON.parse(sampleText);
    console.log("\nSample row:");
    if (sampleData.data && sampleData.data[0]) {
      const row = sampleData.data[0];
      console.log(JSON.stringify(row, null, 2));
    }

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
  }
})();
