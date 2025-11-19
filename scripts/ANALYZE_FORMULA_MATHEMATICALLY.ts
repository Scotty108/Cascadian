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
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("MATHEMATICAL ANALYSIS: Breaking down the formula components");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("TEST: What are the actual components for a single market?\n");

  try {
    // Find a resolved market with niggemon trades
    const market_result = await ch.query({
      query: `
        SELECT
          tf.market_id,
          cc.condition_id_norm,
          wi.win_idx,
          count() as trade_count,
          sum(CAST(tf.cashflow_usdc AS Float64)) as total_cashflows,
          sum(CAST(tf.delta_shares AS Float64)) as total_shares
        FROM trade_flows_v2 AS tf
        INNER JOIN canonical_condition AS cc ON lower(tf.market_id) = lower(cc.market_id)
        INNER JOIN winning_index AS wi ON cc.condition_id_norm = wi.condition_id_norm
        WHERE lower(tf.wallet) = lower('${niggemon}')
          AND wi.win_idx IS NOT NULL
        GROUP BY tf.market_id, cc.condition_id_norm, wi.win_idx
        ORDER BY trade_count DESC
        LIMIT 1
      `,
      format: "JSONCompact"
    });

    const market_text = await market_result.text();
    const market_data = JSON.parse(market_text).data[0];

    if (market_data) {
      const market_id = market_data[0];
      const cond_id = market_data[1];
      const win_idx = market_data[2];
      const trade_count = market_data[3];
      const total_cf = parseFloat(market_data[4]);
      const total_shares = parseFloat(market_data[5]);

      console.log(`Sample Market: ${market_id.substring(0, 16)}...`);
      console.log(`Condition ID: ${cond_id.substring(0, 16)}...`);
      console.log(`Winning Index: ${win_idx}`);
      console.log(`Trade Count: ${trade_count}`);
      console.log(`Total Cashflows: $${total_cf.toFixed(2)}`);
      console.log(`Total Shares: ${total_shares.toFixed(2)}\n`);

      // Now break down by outcome_idx
      console.log("BREAKDOWN BY OUTCOME_IDX:");
      console.log("─".repeat(70));

      const breakdown_result = await ch.query({
        query: `
          SELECT
            tf.trade_idx,
            count() as cnt,
            sum(CAST(tf.cashflow_usdc AS Float64)) as cf_sum,
            sum(CAST(tf.delta_shares AS Float64)) as shares_sum,
            CASE WHEN tf.trade_idx = ${win_idx} THEN 'MATCH(exact)'
                 WHEN tf.trade_idx = ${win_idx} + 1 THEN 'MATCH(+1)'
                 ELSE 'NO MATCH'
            END as match_status
          FROM trade_flows_v2 AS tf
          INNER JOIN canonical_condition AS cc ON lower(tf.market_id) = lower(cc.market_id)
          WHERE lower(tf.wallet) = lower('${niggemon}')
            AND tf.market_id = '${market_id}'
          GROUP BY tf.trade_idx
          ORDER BY tf.trade_idx
        `,
        format: "JSONCompact"
      });

      const bd_text = await breakdown_result.text();
      const bd_data = JSON.parse(bd_text).data || [];

      for (const row of bd_data) {
        const idx = row[0];
        const cnt = row[1];
        const cf = parseFloat(row[2]);
        const shares = parseFloat(row[3]);
        const status = row[4];
        
        console.log(`Index ${idx}: ${status.padEnd(16)} | Count: ${cnt} | Cashflow: $${cf.toFixed(2)} | Shares: ${shares.toFixed(2)}`);
      }

      console.log();
      console.log("IMPLICATIONS:");
      console.log("─".repeat(70));
      console.log(`If win_idx = ${win_idx}:`);
      console.log(`  Exact match (trade_idx = ${win_idx}): Would capture cashflows for that index only`);
      console.log(`  With +1 offset (trade_idx = ${win_idx + 1}): Would capture different index\n`);

      // Calculate what settlement should be with each approach
      const settlement_exact = bd_data.find(row => row[0] === win_idx)?.[3] || 0;
      const settlement_plus_one = bd_data.find(row => row[0] === win_idx + 1)?.[3] || 0;

      console.log("SETTLEMENT CALCULATION:");
      console.log("─".repeat(70));
      console.log(`Using exact match (trade_idx = ${win_idx}):`);
      console.log(`  Settlement shares: ${settlement_exact.toFixed(2)}`);
      console.log(`  Settlement payout (shares × $1.00): $${(settlement_exact * 1).toFixed(2)}`);
      console.log(`  Market P&L: $${total_cf.toFixed(2)} + $${(settlement_exact * 1).toFixed(2)} = $${(total_cf + settlement_exact).toFixed(2)}\n`);

      console.log(`Using +1 offset (trade_idx = ${win_idx + 1}):`);
      console.log(`  Settlement shares: ${settlement_plus_one.toFixed(2)}`);
      console.log(`  Settlement payout (shares × $1.00): $${(settlement_plus_one * 1).toFixed(2)}`);
      console.log(`  Market P&L: $${total_cf.toFixed(2)} + $${(settlement_plus_one * 1).toFixed(2)} = $${(total_cf + settlement_plus_one).toFixed(2)}\n`);

    } else {
      console.log("No resolved markets found with trades\n");
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
