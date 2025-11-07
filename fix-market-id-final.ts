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
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║     FIXING MARKET_ID: Drop the problematic column             ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("Step 1: Create outcome_positions without market_id...");

  // outcome_positions_v2 is already aggregated - just remove market_id
  await ch.command({
    query: `
      CREATE TABLE outcome_positions_v2_fixed AS
      SELECT
        wallet,
        condition_id_norm,
        outcome_idx,
        net_shares
      FROM outcome_positions_v2
      WHERE net_shares != 0
      ORDER BY wallet, condition_id_norm
    `
  });

  console.log("✅ Created outcome_positions_v2_fixed");

  console.log("Step 2: Create trade_cashflows_v3 without market_id...");

  await ch.command({
    query: `
      CREATE TABLE trade_cashflows_v3_fixed AS
      SELECT
        wallet,
        condition_id_norm,
        cashflow_usdc
      FROM trade_cashflows_v3
      WHERE cashflow_usdc != 0
      ORDER BY wallet, condition_id_norm
    `
  });

  console.log("✅ Created trade_cashflows_v3_fixed");

  // Count rows
  const result = await ch.query({
    query: `
      SELECT 'outcome_positions_v2_fixed' as tbl, COUNT(*) as cnt FROM outcome_positions_v2_fixed
      UNION ALL
      SELECT 'trade_cashflows_v3_fixed', COUNT(*) FROM trade_cashflows_v3_fixed
    `,
    format: "JSONCompact"
  });

  const text = await result.text();
  const data = JSON.parse(text).data;

  console.log("\n📊 Row Counts:");
  for (const [name, cnt] of data) {
    console.log(`   ${name}: ${cnt}`);
  }

  console.log("\n✅ Tables created successfully!");
  console.log("\n🔄 Next step: Swap the tables");
  console.log("   RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;");
  console.log("   RENAME TABLE outcome_positions_v2_fixed TO outcome_positions_v2;");
  console.log("   RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old;");
  console.log("   RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3;");
}

main().catch(e => console.error("Error:", e.message));
