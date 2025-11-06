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

    // Test with small limit
    const query = await ch.query({
      query: `SELECT * FROM erc1155_transfers WHERE lower(contract) = lower('${CT}') LIMIT 3`,
    });

    const text = await query.text();
    console.log("Raw query response:\n");
    console.log(text);
    console.log("\n\nResponse length:", text.length);
    console.log("First 500 chars:", text.substring(0, 500));

    // Try parsing as JSON directly
    try {
      const data = JSON.parse(text);
      console.log("\n\nParsed as JSON:");
      console.log("  data rows:", (data.data || []).length);
      if (data.data && data.data[0]) {
        console.log("\n  First row keys:", Object.keys(data.data[0]));
      }
    } catch (e) {
      console.log("\n\nFailed to parse as JSON:", e.message);
    }

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
  }
})();
