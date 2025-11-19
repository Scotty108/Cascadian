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
    console.log("Setting up pm_trades table with corrected schema...\n");

    // Drop old table
    console.log("Dropping old pm_trades table...");
    await ch.exec({
      query: "DROP TABLE IF EXISTS pm_trades",
    });
    console.log("✅ Old table dropped\n");

    // Create new table with id as primary key
    console.log("Creating pm_trades with id as primary key...");
    await ch.exec({
      query: `
        CREATE TABLE pm_trades (
          id String,
          transaction_hash String DEFAULT '',
          proxy_wallet String,
          market_id String DEFAULT '',
          side String DEFAULT '',
          size String DEFAULT '0',
          price String DEFAULT '0',
          ts DateTime,
          notional String DEFAULT '0'
        )
        ENGINE = ReplacingMergeTree()
        PRIMARY KEY (id)
        ORDER BY (id)
        PARTITION BY toYYYYMMDD(ts)
      `,
    });
    console.log("✅ pm_trades table created\n");

    // Verify table structure
    const schemaQ = await ch.query({
      query: "DESCRIBE pm_trades",
    });

    const schemaText = await schemaQ.text();
    console.log("Table Schema:");
    console.log(schemaText);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
})();
