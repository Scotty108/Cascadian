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
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   EXAMINING THE EXISTING 'pnl' FIELD IN trades_raw            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("STEP 1: Sample of trades with their pnl values\n");

  const sample = await ch.query({
    query: `
      SELECT
        trade_id,
        side,
        entry_price,
        exit_price,
        shares,
        pnl,
        pnl_net,
        return_pct,
        is_resolved,
        resolved_outcome
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
        AND pnl IS NOT NULL
      LIMIT 10
    `,
    format: "JSONCompact"
  });

  const sampleText = await sample.text();
  const sampleData = JSON.parse(sampleText).data;
  
  console.log("Sample trades with non-NULL pnl:");
  for (const row of sampleData) {
    const [tid, side, ep, xp, shares, pnl, pnl_net, ret, resolved, outcome] = row;
    console.log(
      `  Side: ${side} | Entry: ${ep} | Exit: ${xp} | Shares: ${shares} | PNL: ${pnl} | Net: ${pnl_net}`
    );
  }

  // Step 2: Sum all pnl values
  console.log("\n\nSTEP 2: Sum all pnl values\n");

  const pnlSum = await ch.query({
    query: `
      SELECT
        COUNT(*) as trade_count,
        COUNT(CASE WHEN pnl IS NOT NULL THEN 1 END) as with_pnl,
        COUNT(CASE WHEN pnl_net IS NOT NULL THEN 1 END) as with_pnl_net,
        SUM(CAST(pnl AS Float64)) as total_pnl,
        SUM(CAST(pnl_net AS Float64)) as total_pnl_net,
        SUM(CAST(return_pct AS Float64)) as avg_return_pct
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
    `,
    format: "JSONCompact"
  });

  const pnlSumText = await pnlSum.text();
  const pnlSumData = JSON.parse(pnlSumText).data;
  const [total, with_pnl, with_pnl_net, sum_pnl, sum_pnl_net, avg_ret] = pnlSumData[0];

  console.log(`  Total trades: ${total}`);
  console.log(`  Trades with pnl: ${with_pnl}`);
  console.log(`  Trades with pnl_net: ${with_pnl_net}`);
  console.log(`  SUM(pnl): $${sum_pnl?.toFixed(2)}`);
  console.log(`  SUM(pnl_net): $${sum_pnl_net?.toFixed(2)}`);
  console.log(`  AVG(return_pct): ${avg_ret?.toFixed(4)}`);

  // Step 3: Filter to resolved trades only
  console.log("\n\nSTEP 3: Sum pnl for is_resolved = 1 trades\n");

  const resolved = await ch.query({
    query: `
      SELECT
        COUNT(*) as resolved_count,
        SUM(CAST(pnl AS Float64)) as total_pnl,
        SUM(CAST(pnl_net AS Float64)) as total_pnl_net
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
        AND is_resolved = 1
    `,
    format: "JSONCompact"
  });

  const resolvedText = await resolved.text();
  const resolvedData = JSON.parse(resolvedText).data;
  const [resolved_count, res_pnl, res_pnl_net] = resolvedData[0];

  const variance = ((res_pnl - 102001.46) / 102001.46 * 100).toFixed(2);
  const icon = Math.abs(variance) < 10 ? "✅" : "❌";

  console.log(`${icon} Resolved trades (is_resolved=1): ${resolved_count}`);
  console.log(`  SUM(pnl): $${res_pnl?.toFixed(2)}`);
  console.log(`  SUM(pnl_net): $${res_pnl_net?.toFixed(2)}`);
  console.log(`  Target: $102,001.46`);
  console.log(`  Variance: ${variance}%`);

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║              DIAGNOSIS COMPLETE                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
