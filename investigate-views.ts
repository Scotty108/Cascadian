import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

config({ path: '.env.local' });

async function investigateViews() {
  console.log("=".repeat(80));
  console.log("INVESTIGATING MATERIALIZED VIEW DEFINITIONS");
  console.log("=".repeat(80));

  // Get view definitions
  const query = `
    SELECT
      name,
      create_table_query
    FROM system.tables
    WHERE database = currentDatabase()
    AND name IN ('wallet_realized_pnl_v2', 'wallet_pnl_summary_v2')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data: any[] = await result.json();

  for (const row of data) {
    console.log("\n" + "=".repeat(80));
    console.log("VIEW: " + row.name);
    console.log("=".repeat(80));
    console.log(row.create_table_query);
  }
}

investigateViews().catch(console.error);
