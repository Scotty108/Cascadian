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
  console.log("\n🔄 SWAPPING FIXED TABLES INTO PRODUCTION\n");

  const timestamp = new Date().toISOString().replace(/[:-]/g, "").split(".")[0];

  try {
    console.log("Step 1: Backing up current tables...");
    await ch.command({ query: `RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_backup_${timestamp}` });
    console.log(`  ✓ outcome_positions_v2 → outcome_positions_v2_backup_${timestamp}`);

    await ch.command({ query: `RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_backup_${timestamp}` });
    console.log(`  ✓ trade_cashflows_v3 → trade_cashflows_v3_backup_${timestamp}`);

    console.log("\nStep 2: Promoting fixed tables...");
    await ch.command({ query: `RENAME TABLE outcome_positions_v2_fixed TO outcome_positions_v2` });
    console.log(`  ✓ outcome_positions_v2_fixed → outcome_positions_v2`);

    await ch.command({ query: `RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3` });
    console.log(`  ✓ trade_cashflows_v3_fixed → trade_cashflows_v3`);

    console.log(`\n✅ Tables swapped successfully!`);
    console.log(`\n📦 Backup tables (can be dropped later):`);
    console.log(`  - outcome_positions_v2_backup_${timestamp}`);
    console.log(`  - trade_cashflows_v3_backup_${timestamp}`);

  } catch (e: any) {
    console.error(`\n❌ Swap failed: ${e.message}`);
    process.exit(1);
  }
}

main();
