#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 300000,
});

async function main() {
  console.log("\n🔧 REBUILDING winning_index FROM market_resolutions_final\n");

  try {
    console.log("Step 1: Backing up current winning_index...");
    const timestamp = new Date().toISOString().replace(/[:-]/g, "").split(".")[0];
    await ch.command({ query: `RENAME TABLE winning_index TO winning_index_backup_${timestamp}` });
    console.log(`  ✓ winning_index → winning_index_backup_${timestamp}`);

    console.log("\nStep 2: Creating new winning_index from market_resolutions_final...");
    await ch.command({
      query: `
        CREATE TABLE winning_index
        ENGINE = MergeTree()
        ORDER BY (condition_id_norm)
        AS SELECT
          toString(condition_id_norm) AS condition_id_norm,
          toInt16(winning_index) AS win_idx,
          resolved_at
        FROM market_resolutions_final
      `
    });
    console.log("  ✓ Created winning_index");

    // Get row counts
    const result = await ch.query({
      query: `
        SELECT 'winning_index' as tbl, COUNT(*) as cnt FROM winning_index
        UNION ALL
        SELECT 'winning_index_backup', COUNT(*) FROM winning_index_backup_${timestamp}
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data;
    
    console.log("\n📊 Row Counts:");
    for (const [name, cnt] of data) {
      console.log(`  ${name}: ${cnt}`);
    }
    
    console.log(`\n✅ Rebuilt winning_index from market_resolutions_final!`);
    console.log(`\n📦 Backup table (can be dropped):`);
    console.log(`  - winning_index_backup_${timestamp}`);
    
  } catch (e: any) {
    console.error(`\n❌ Error: ${e.message}`);
    process.exit(1);
  }
}

main();
