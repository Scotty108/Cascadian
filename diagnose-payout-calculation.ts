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
  console.log("║   DIAGNOSING PAYOUT CALCULATION FOR NIGGEMON P&L              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Step 1: Check what's in trades_enriched
  console.log("STEP 1: Sample of trades_enriched data\n");
  const sample = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        shares,
        entry_price,
        realized_pnl_usd,
        is_resolved
      FROM trades_enriched
      WHERE wallet_address = lower('${wallet}')
      LIMIT 5
    `,
    format: "JSONCompact"
  });

  const sampleText = await sample.text();
  const sampleData = JSON.parse(sampleText).data;
  console.log("Sample trades from trades_enriched:");
  for (const row of sampleData) {
    const [cid, oi, shares, ep, rpnl, resolved] = row;
    console.log(
      `  CID: ${cid?.substring(0, 8)}... | OI: ${oi} | Shares: ${shares} | Entry: ${ep} | P&L: ${rpnl} | Resolved: ${resolved}`
    );
  }

  // Step 2: Count total by resolution status
  console.log("\n\nSTEP 2: Breakdown by resolution status\n");
  const breakdown = await ch.query({
    query: `
      SELECT
        is_resolved,
        COUNT(*) as trade_count,
        SUM(toFloat64(realized_pnl_usd)) as total_pnl
      FROM trades_enriched
      WHERE wallet_address = lower('${wallet}')
      GROUP BY is_resolved
      ORDER BY is_resolved DESC
    `,
    format: "JSONCompact"
  });

  const breakdownText = await breakdown.text();
  const breakdownData = JSON.parse(breakdownText).data;
  console.log("Trades by resolution status:");
  for (const row of breakdownData) {
    const [resolved, count, pnl] = row;
    console.log(`  is_resolved=${resolved}: ${count} trades | Total P&L: $${pnl?.toFixed(2) || '0.00'}`);
  }

  // Step 3: Check if trades have winning_index present
  console.log("\n\nSTEP 3: Are trades linked to winning_index?\n");
  const winning = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT t.condition_id_norm) as unique_conditions,
        SUM(IF(w.condition_id_norm IS NOT NULL, 1, 0)) as with_winning_idx
      FROM trades_enriched t
      LEFT JOIN winning_index w ON t.condition_id_norm = w.condition_id_norm
      WHERE t.wallet_address = lower('${wallet}')
    `,
    format: "JSONCompact"
  });

  const winningText = await winning.text();
  const winningData = JSON.parse(winningText).data;
  const [totalTrades, uniqueCond, withWinning] = winningData[0];
  console.log(`  Total trades: ${totalTrades}`);
  console.log(`  Unique conditions: ${uniqueCond}`);
  console.log(`  Trades with winning_index match: ${withWinning}`);

  // Step 4: Manual P&L calculation from scratch
  console.log("\n\nSTEP 4: Recalculate P&L from payout vectors\n");
  const manual = await ch.query({
    query: `
      SELECT
        SUM(
          SUM(
            IF(
              t.outcome_index = w.winning_index,
              CAST(t.shares AS Float64) * 1.0,
              0
            )
          ) * CAST(1.0 AS Float64) -
          SUM(CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64) *
              IF(t.side = 'YES', -1, 1))
        ) as recalc_pnl
      FROM trades_enriched t
      LEFT JOIN winning_index w ON t.condition_id_norm = w.condition_id_norm
      WHERE t.wallet_address = lower('${wallet}')
        AND w.condition_id_norm IS NOT NULL
    `,
    format: "JSONCompact"
  });

  const manualText = await manual.text();
  const manualData = JSON.parse(manualText).data;
  console.log(`  Recalculated P&L from payout vectors: $${manualData[0][0]?.toFixed(2) || '0.00'}`);

  // Step 5: Check a specific winning condition
  console.log("\n\nSTEP 5: Detailed analysis of a specific winning condition\n");
  const specific = await ch.query({
    query: `
      SELECT
        t.condition_id_norm,
        w.winning_index,
        COUNT(*) as trade_count,
        SUM(CAST(t.shares AS Float64)) as total_shares,
        SUM(
          IF(t.outcome_index = w.winning_index, CAST(t.shares AS Float64), 0)
        ) as winning_shares,
        SUM(
          CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64)
        ) as total_spent
      FROM trades_enriched t
      LEFT JOIN winning_index w ON t.condition_id_norm = w.condition_id_norm
      WHERE t.wallet_address = lower('${wallet}')
        AND w.condition_id_norm IS NOT NULL
      GROUP BY t.condition_id_norm, w.winning_index
      ORDER BY winning_shares DESC
      LIMIT 3
    `,
    format: "JSONCompact"
  });

  const specificText = await specific.text();
  const specificData = JSON.parse(specificText).data;
  console.log("Top 3 conditions by winning shares:");
  for (const row of specificData) {
    const [cid, wi, trades, totalShares, winningShares, spent] = row;
    const pnl = (winningShares * 1.0) - spent;
    console.log(`  CID: ${cid?.substring(0, 8)}... | Winning IDX: ${wi}`);
    console.log(
      `    Trades: ${trades} | Total Shares: ${totalShares?.toFixed(4)} | Winning: ${winningShares?.toFixed(4)} | Spent: $${spent?.toFixed(2)}`
    );
    console.log(`    Implied P&L: $${pnl?.toFixed(2)}`);
  }

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║              DIAGNOSIS COMPLETE                               ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
