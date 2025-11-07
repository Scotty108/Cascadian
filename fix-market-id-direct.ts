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
  console.log("\n🔧 Creating deduplicated outcome_positions_v2_fixed...\n");

  // Create without market_id (that's the problem column)
  await ch.command({
    query: `
      CREATE TABLE outcome_positions_v2_fixed AS
      SELECT
        wallet,
        condition_id_norm,
        outcome_idx,
        SUM(net_shares) AS net_shares
      FROM outcome_positions_v2
      WHERE outcome_idx >= 0 AND net_shares != 0
      GROUP BY wallet, condition_id_norm, outcome_idx
      ORDER BY wallet, condition_id_norm
    `
  });

  console.log("✅ Created outcome_positions_v2_fixed");

  console.log("🔧 Creating deduplicated trade_cashflows_v3_fixed...\n");

  await ch.command({
    query: `
      CREATE TABLE trade_cashflows_v3_fixed AS
      SELECT
        wallet,
        condition_id_norm,
        SUM(cashflow_usdc) AS cashflow_usdc
      FROM trade_cashflows_v3
      WHERE cashflow_usdc != 0
      GROUP BY wallet, condition_id_norm
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
  console.log("\n🔄 Next: Swap tables with these commands:");
  console.log("   RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;");
  console.log("   RENAME TABLE outcome_positions_v2_fixed TO outcome_positions_v2;");
  console.log("   RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old;");
  console.log("   RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3;");
}

main().catch(e => console.error("Error:", e.message));
