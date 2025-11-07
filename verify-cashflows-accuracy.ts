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
  console.log("VERIFICATION: Comparing cashflows from different sources");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Get one sample condition
  console.log("STEP 1: Find a sample condition");
  console.log("─".repeat(70));

  try {
    const cond_result = await ch.query({
      query: `
        SELECT condition_id_norm
        FROM trade_cashflows_v3
        WHERE lower(wallet) = lower('${niggemon}')
        LIMIT 1
      `,
      format: "JSONCompact"
    });

    const cond_text = await cond_result.text();
    const cond_data = JSON.parse(cond_text).data[0];
    const sample_cond = cond_data[0];

    console.log(`Sample condition: ${sample_cond}\n`);

    // Now compare the same condition from different sources
    console.log("STEP 2: Compare calculation sources for this condition");
    console.log("─".repeat(70));

    // Source 1: trade_cashflows_v3 (summarized)
    const tcf_result = await ch.query({
      query: `
        SELECT
          count() as tcf_rows,
          sum(CAST(cashflow_usdc AS Float64)) as tcf_sum,
          min(CAST(cashflow_usdc AS Float64)) as tcf_min,
          max(CAST(cashflow_usdc AS Float64)) as tcf_max,
          avg(CAST(cashflow_usdc AS Float64)) as tcf_avg
        FROM trade_cashflows_v3
        WHERE lower(wallet) = lower('${niggemon}')
          AND condition_id_norm = '${sample_cond}'
      `,
      format: "JSONCompact"
    });

    const tcf_text = await tcf_result.text();
    const tcf_data = JSON.parse(tcf_text).data[0];

    console.log("From trade_cashflows_v3:");
    console.log(`  Rows: ${tcf_data[0]}`);
    console.log(`  Sum: $${parseFloat(tcf_data[1] || "0").toFixed(2)}`);
    console.log(`  Min: $${parseFloat(tcf_data[2] || "0").toFixed(2)}`);
    console.log(`  Max: $${parseFloat(tcf_data[3] || "0").toFixed(2)}`);
    console.log(`  Avg: $${parseFloat(tcf_data[4] || "0").toFixed(2)}\n`);

    // Source 2: trades_raw for this condition
    const tr_result = await ch.query({
      query: `
        SELECT
          count() as tr_rows,
          sum(
            CAST(entry_price AS Float64) * CAST(shares AS Float64) *
            (CASE WHEN lower(toString(side)) = 'buy' THEN -1 ELSE 1 END)
          ) as tr_sum
        FROM trades_raw tr
        INNER JOIN canonical_condition cc ON lower(tr.market_id) = lower(cc.market_id)
        WHERE lower(tr.wallet_address) = lower('${niggemon}')
          AND cc.condition_id_norm = '${sample_cond}'
      `,
      format: "JSONCompact"
    });

    const tr_text = await tr_result.text();
    const tr_data = JSON.parse(tr_text).data[0];

    console.log("From trades_raw:");
    console.log(`  Rows: ${tr_data[0]}`);
    console.log(`  Sum cashflows: $${parseFloat(tr_data[1] || "0").toFixed(2)}\n`);

    // Check if this is a resolved condition
    console.log("STEP 3: Check if this condition is resolved");
    console.log("─".repeat(70));

    const res_result = await ch.query({
      query: `
        SELECT
          condition_id_norm,
          win_idx,
          resolved_at
        FROM winning_index
        WHERE condition_id_norm = '${sample_cond}'
      `,
      format: "JSONCompact"
    });

    const res_text = await res_result.text();
    const res_data = JSON.parse(res_text).data[0];

    if (res_data) {
      console.log(`Resolved: YES`);
      console.log(`  Win index: ${res_data[1]}`);
      console.log(`  Resolved at: ${res_data[2]}\n`);
    } else {
      console.log(`Resolved: NO\n`);
    }

    // Check wallet's net position in this condition
    console.log("STEP 4: Check net position in this condition");
    console.log("─".repeat(70));

    const pos_result = await ch.query({
      query: `
        SELECT
          SUM(CASE WHEN lower(toString(side)) = 'buy' THEN CAST(shares AS Float64) ELSE -CAST(shares AS Float64) END) as net_shares
        FROM trades_raw tr
        INNER JOIN canonical_condition cc ON lower(tr.market_id) = lower(cc.market_id)
        WHERE lower(tr.wallet_address) = lower('${niggemon}')
          AND cc.condition_id_norm = '${sample_cond}'
      `,
      format: "JSONCompact"
    });

    const pos_text = await pos_result.text();
    const pos_data = JSON.parse(pos_text).data[0];

    console.log(`Net shares held: ${parseFloat(pos_data[0] || "0").toFixed(2)}`);
    console.log();

    // Now check what the view returns for this condition
    console.log("STEP 5: Check realized_pnl_by_market_v2 for this condition");
    console.log("─".repeat(70));

    // Find the market_id for this condition
    const market_result = await ch.query({
      query: `
        SELECT market_id
        FROM canonical_condition
        WHERE condition_id_norm = '${sample_cond}'
        LIMIT 1
      `,
      format: "JSONCompact"
    });

    const market_text = await market_result.text();
    const market_data = JSON.parse(market_text).data[0];
    
    if (market_data) {
      const market_id = market_data[0];

      const view_result = await ch.query({
        query: `
          SELECT
            realized_pnl_usd,
            fill_count
          FROM realized_pnl_by_market_v2
          WHERE lower(wallet) = lower('${niggemon}')
            AND market_id = '${market_id}'
            AND condition_id_norm = '${sample_cond}'
          LIMIT 1
        `,
        format: "JSONCompact"
      });

      const view_text = await view_result.text();
      const view_data = JSON.parse(view_text).data[0];

      if (view_data) {
        console.log(`View P&L: $${parseFloat(view_data[0] || "0").toFixed(2)}`);
        console.log(`Fills: ${view_data[1]}\n`);
      } else {
        console.log("No data in view for this condition\n");
      }
    }

  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
