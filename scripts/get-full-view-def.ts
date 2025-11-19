#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function main() {
  const viewNames = ['trade_flows_v2', 'canonical_condition', 'winning_index'];

  for (const viewName of viewNames) {
    console.log(`\n════════════════════════════════════════════════════════════════`);
    console.log(`VIEW: ${viewName}`);
    console.log(`════════════════════════════════════════════════════════════════\n`);

    try {
      const result = await ch.query({
        query: `
          SELECT create_table_query
          FROM system.tables
          WHERE database = 'default' AND name = '${viewName}'
        `,
        format: "JSONCompact"
      });

      const text = await result.text();
      const data = JSON.parse(text).data || [];
      
      if (data.length > 0) {
        const query = data[0][0];
        console.log(query);
      } else {
        console.log("View not found");
      }
    } catch (e: any) {
      console.log(`Error: ${e.message}`);
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════\n`);
}

main().catch(console.error);
