import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 60000,
});

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║           SWAPPING FIXED TABLES INTO PRODUCTION               ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const timestamp = new Date().toISOString().replace(/[:-]/g, "").split(".")[0];

  try {
    console.log("Step 1: Backup original tables...");
    await ch.command({ query: `RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_backup_${timestamp}` });
    console.log("   ✅ outcome_positions_v2 → outcome_positions_v2_backup_${timestamp}");

    await ch.command({ query: `RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_backup_${timestamp}` });
    console.log("   ✅ trade_cashflows_v3 → trade_cashflows_v3_backup_${timestamp}");

    console.log("\nStep 2: Promote fixed tables...");
    await ch.command({ query: `RENAME TABLE outcome_positions_v2_fixed TO outcome_positions_v2` });
    console.log("   ✅ outcome_positions_v2_fixed → outcome_positions_v2");

    await ch.command({ query: `RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3` });
    console.log("   ✅ trade_cashflows_v3_fixed → trade_cashflows_v3");

    console.log("\n✅ Tables swapped successfully!");
    console.log(`\nBackup tables (can be dropped later):`);
    console.log(`  - outcome_positions_v2_backup_${timestamp}`);
    console.log(`  - trade_cashflows_v3_backup_${timestamp}`);

  } catch (e: any) {
    console.error(`\n❌ Swap failed: ${e.message}`);
    console.log("\n🔄 Attempting rollback...");
    try {
      await ch.command({ query: `RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_broken` });
      await ch.command({ query: `RENAME TABLE outcome_positions_v2_backup_${timestamp} TO outcome_positions_v2` });
      await ch.command({ query: `RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_broken` });
      await ch.command({ query: `RENAME TABLE trade_cashflows_v3_backup_${timestamp} TO trade_cashflows_v3` });
      console.log("✅ Rollback successful");
    } catch (e2) {
      console.error(`Rollback also failed: ${e2.message}`);
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
