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
  console.log("\n🔄 ROLLING BACK TABLE SWAP\n");

  try {
    // Drop the broken current tables
    console.log("Dropping broken current tables...");
    await ch.command({ query: "DROP TABLE outcome_positions_v2" });
    console.log("  ✓ outcome_positions_v2 dropped");
    
    await ch.command({ query: "DROP TABLE trade_cashflows_v3" });
    console.log("  ✓ trade_cashflows_v3 dropped");
    
    // Restore from backups
    console.log("\nRestoring from backups...");
    await ch.command({ query: "RENAME TABLE outcome_positions_v2_backup_20251107T071726 TO outcome_positions_v2" });
    console.log("  ✓ outcome_positions_v2_backup → outcome_positions_v2");
    
    await ch.command({ query: "RENAME TABLE trade_cashflows_v3_backup_20251107T071726 TO trade_cashflows_v3" });
    console.log("  ✓ trade_cashflows_v3_backup → trade_cashflows_v3");
    
    console.log("\n✅ Rollback complete - tables restored");
  } catch (e: any) {
    console.error(`❌ Rollback failed: ${e.message}`);
  }
}

main();
