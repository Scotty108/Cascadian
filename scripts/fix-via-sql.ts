import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 300000,
});

async function main() {
  console.log("\n🔧 Step 1: Create outcome_positions_v2_fixed with proper engine...\n");

  // For ClickHouse Cloud, we need to specify ORDER BY
  try {
    await ch.command({
      query: `
        CREATE TABLE outcome_positions_v2_fixed
        ENGINE = MergeTree()
        ORDER BY (wallet, condition_id_norm)
        AS SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          net_shares
        FROM outcome_positions_v2
        WHERE net_shares != 0
      `
    });
    console.log("✅ Created outcome_positions_v2_fixed");
  } catch (e: any) {
    console.error(`❌ Failed: ${e.message}`);
    process.exit(1);
  }

  console.log("\n🔧 Step 2: Create trade_cashflows_v3_fixed with proper engine...\n");

  try {
    await ch.command({
      query: `
        CREATE TABLE trade_cashflows_v3_fixed
        ENGINE = MergeTree()
        ORDER BY (wallet, condition_id_norm)
        AS SELECT
          wallet,
          condition_id_norm,
          cashflow_usdc
        FROM trade_cashflows_v3
        WHERE cashflow_usdc != 0
      `
    });
    console.log("✅ Created trade_cashflows_v3_fixed");
  } catch (e: any) {
    console.error(`❌ Failed: ${e.message}`);
    process.exit(1);
  }

  // Get row counts
  const counts = await ch.query({
    query: `
      SELECT 'outcome_positions_v2_fixed' as tbl, COUNT(*) as cnt FROM outcome_positions_v2_fixed
      UNION ALL
      SELECT 'trade_cashflows_v3_fixed', COUNT(*) FROM trade_cashflows_v3_fixed
    `,
    format: "JSONCompact"
  });

  const text = await counts.text();
  const data = JSON.parse(text).data;

  console.log("\n📊 Row Counts:");
  for (const [name, cnt] of data) {
    console.log(`   ${name}: ${cnt}`);
  }

  console.log("\n✅ Fixed tables created!");
  console.log("\n🔄 Swap tables with these commands in ClickHouse:");
  console.log("");
  console.log("   RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;");
  console.log("   RENAME TABLE outcome_positions_v2_fixed TO outcome_positions_v2;");
  console.log("");
  console.log("   RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old;");
  console.log("   RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3;");
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
