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
  console.log("║   USING THE EXISTING 'pnl_net' FIELD (trades_raw)             ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Step 1: Sum using COALESCE
  console.log("STEP 1: Sum all pnl_net values (resolved and unresolved)\n");

  const allPnl = await ch.query({
    query: `
      SELECT
        COUNT(*) as trade_count,
        SUM(COALESCE(pnl_net, 0)) as total_pnl_net,
        SUM(IF(pnl_net > 0, pnl_net, 0)) as total_wins,
        SUM(IF(pnl_net < 0, ABS(pnl_net), 0)) as total_losses
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
    `,
    format: "JSONCompact"
  });

  const allPnlText = await allPnl.text();
  const allPnlData = JSON.parse(allPnlText).data;
  const [total, sum_pnl, wins, losses] = allPnlData[0];

  console.log(`  Total trades: ${total}`);
  console.log(`  SUM(pnl_net): $${sum_pnl?.toFixed(2)}`);
  console.log(`  SUM(wins): $${wins?.toFixed(2)}`);
  console.log(`  SUM(losses): -$${losses?.toFixed(2)}`);

  // Step 2: Filter to resolved trades only
  console.log("\n\nSTEP 2: Sum pnl_net for is_resolved = 1 trades\n");

  const resolved = await ch.query({
    query: `
      SELECT
        COUNT(*) as resolved_count,
        SUM(COALESCE(pnl_net, 0)) as total_pnl_net,
        SUM(IF(pnl_net > 0, pnl_net, 0)) as total_wins,
        SUM(IF(pnl_net < 0, ABS(pnl_net), 0)) as total_losses
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
        AND is_resolved = 1
    `,
    format: "JSONCompact"
  });

  const resolvedText = await resolved.text();
  const resolvedData = JSON.parse(resolvedText).data;
  const [res_count, res_pnl, res_wins, res_losses] = resolvedData[0];

  const variance = ((res_pnl - 102001.46) / 102001.46 * 100).toFixed(2);
  const icon = Math.abs(variance) < 10 ? "✅" : "❌";

  console.log(`${icon} Resolved trades (is_resolved=1): ${res_count}`);
  console.log(`  SUM(pnl_net): $${res_pnl?.toFixed(2)}`);
  console.log(`  SUM(wins): $${res_wins?.toFixed(2)}`);
  console.log(`  SUM(losses): -$${res_losses?.toFixed(2)}`);
  console.log(`  Target: $102,001.46`);
  console.log(`  Variance: ${variance}%`);

  // Step 3: Check realized_pnl_usd field
  console.log("\n\nSTEP 3: Compare with realized_pnl_usd field\n");

  const rpnl = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(toFloat64(realized_pnl_usd)) as total_rpnl
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
    `,
    format: "JSONCompact"
  });

  const rpnlText = await rpnl.text();
  const rpnlData = JSON.parse(rpnlText).data;
  const [rpnl_count, rpnl_sum] = rpnlData[0];

  console.log(`  Total trades: ${rpnl_count}`);
  console.log(`  SUM(realized_pnl_usd): $${rpnl_sum?.toFixed(2)}`);

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║              SUMMARY                                           ║");
  console.log("║                                                                ║");
  console.log("║  The realized_pnl_usd field contains pre-calculated PnL        ║");
  console.log("║  values, but they're only populated for RESOLVED trades.       ║");
  console.log("║                                                                ║");
  console.log("║  We need to rebuild wallet_pnl_correct using the              ║");
  console.log("║  realized_pnl_usd field from trades_raw (summed by wallet)     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
