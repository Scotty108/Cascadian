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
  console.log("\n🔍 FINDING ACTUAL P&L TABLES IN DATABASE\n");
  
  try {
    // List all tables with schemas
    const tables = await ch.query({
      query: `
        SELECT 
          name,
          engine,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE database = 'default'
        AND (name LIKE '%pnl%' OR name LIKE '%wallet%' OR name LIKE '%position%' OR name LIKE '%realized%')
        ORDER BY name
      `,
      format: "JSONCompact"
    });
    
    const tableText = await tables.text();
    const tableData = JSON.parse(tableText).data || [];
    
    console.log(`Found ${tableData.length} tables:\n`);
    
    for (const row of tableData) {
      console.log(`📊 ${row[0]}`);
      console.log(`   Engine: ${row[1]}`);
      console.log(`   Rows: ${row[2]?.toLocaleString() || 'N/A'}`);
      console.log(`   Size: ${row[3]}`);
      console.log("");
    }
    
    // Now check trades_raw structure
    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("trades_raw FIELDS:\n");
    
    const schema = await ch.query({
      query: "DESC trades_raw",
      format: "JSONCompact"
    });
    
    const schemaText = await schema.text();
    const schemaData = JSON.parse(schemaText).data || [];
    
    const relevant = schemaData.filter((row: any[]) =>
      row[0].includes('side') || 
      row[0].includes('price') ||
      row[0].includes('shares') ||
      row[0].includes('outcome') ||
      row[0].includes('pnl') ||
      row[0].includes('resolved') ||
      row[0].includes('wallet')
    );
    
    for (const row of relevant) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();
